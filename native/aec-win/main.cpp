// Windows VoiceCapture DMO AEC sidecar — the mirror of native/aec-mac (VPIO).
//
// ⚠️ UNTESTED: written without a Windows toolchain. The architecture + APIs are
// real, but it has NOT been compiled or run. Expect to fix compile errors and tune
// format/device details on an actual Windows box. Spots that most likely need
// attention are marked `// VERIFY`.
//
// Same stdio contract as the macOS sidecar so the Node side is identical:
//   stdin  ← far-end PCM16 (24 kHz mono LE)  — the model's audio. We render it to the
//            default speaker via WASAPI, which is what the AEC DMO references.
//   stdout → near-end PCM16 (24 kHz mono LE) — the microphone, echo-cancelled by the
//            Voice Capture DMO (CWMAudioAEC) in source mode.
//   fd 3   ← control bytes: 'f' = flush playback (barge-in). (macOS uses SIGUSR1;
//            Windows can't receive POSIX signals, so Node opens a 4th pipe.)
//
// Mechanism: the DMO's "source mode" AEC references whatever is playing on the
// default render endpoint, so we render the far-end there ourselves to guarantee a
// well-formed, time-aligned reference (mirroring how VPIO owns both directions). The
// DMO works at <=16 kHz, so the mic is captured/cancelled at 16 kHz and resampled to
// 24 kHz for stdout; the 24 kHz far-end is resampled to the render device's mix
// format. Diagnostics go to stderr; stdout is PCM only.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <mmreg.h>
#include <wmcodecdsp.h>   // CLSID_CWMAudioAEC, MFPKEY_WMAAECMA_*
#include <mediaobj.h>     // IMediaObject, IMediaBuffer
#include <propsys.h>
#include <propidl.h>
#include <objbase.h>
#include <io.h>
#include <fcntl.h>
#include <cstdio>
#include <cstdint>
#include <vector>
#include <mutex>
#include <thread>
#include <atomic>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "wmcodecdspuuid.lib")

static constexpr int OUT_RATE = 24000;  // contract rate to/from Node
static constexpr int DMO_RATE = 16000;  // AEC DMO works at <=16 kHz

static void logln(const char* s) { fprintf(stderr, "%s\n", s); fflush(stderr); }
#define HR(call, what) do { HRESULT _hr = (call); if (FAILED(_hr)) { fprintf(stderr, "ERROR %s: hr=0x%08lx\n", what, _hr); return 2; } } while (0)

// ---- Far-end ring (PCM16 @ OUT_RATE), filled by stdin, drained by the render thread.
struct Ring {
  std::vector<int16_t> buf;
  size_t rd = 0, wr = 0, count = 0, cap;
  std::mutex m;
  explicit Ring(size_t capacity) : buf(capacity), cap(capacity) {}
  void write(const int16_t* p, size_t n) {                 // backpressure-free: caller is realtime-ish
    std::lock_guard<std::mutex> lk(m);
    for (size_t i = 0; i < n; i++) {
      buf[wr] = p[i]; wr = (wr + 1) % cap;
      if (count < cap) count++; else rd = (rd + 1) % cap;  // overflow → drop oldest (render keeps up)
    }
  }
  void read(int16_t* p, size_t n) {                        // underrun → silence
    std::lock_guard<std::mutex> lk(m);
    for (size_t i = 0; i < n; i++) {
      if (count) { p[i] = buf[rd]; rd = (rd + 1) % cap; count--; } else p[i] = 0;
    }
  }
  void clear() { std::lock_guard<std::mutex> lk(m); rd = wr = count = 0; }  // barge-in flush
};

static Ring g_far(OUT_RATE * 8);     // ~8s of far-end @ 24 kHz
static std::atomic<bool> g_running{true};

// Linear resampler: src @ srcRate (mono int16) → dst @ dstRate (mono int16).
static std::vector<int16_t> resample(const int16_t* src, size_t n, int srcRate, int dstRate) {
  if (srcRate == dstRate) return std::vector<int16_t>(src, src + n);
  size_t outN = (size_t)((double)n * dstRate / srcRate);
  std::vector<int16_t> out(outN);
  for (size_t i = 0; i < outN; i++) {
    double srcPos = (double)i * srcRate / dstRate;
    size_t j = (size_t)srcPos;
    double frac = srcPos - j;
    int16_t a = src[j < n ? j : n - 1];
    int16_t b = src[j + 1 < n ? j + 1 : n - 1];
    out[i] = (int16_t)(a + (b - a) * frac);
  }
  return out;
}

// Minimal IMediaBuffer for the DMO ProcessOutput call.
class MediaBuffer : public IMediaBuffer {
  BYTE* data; DWORD len = 0; const DWORD maxLen; LONG ref = 1;
public:
  explicit MediaBuffer(DWORD cap) : maxLen(cap) { data = (BYTE*)CoTaskMemAlloc(cap); }
  ~MediaBuffer() { CoTaskMemFree(data); }
  STDMETHODIMP SetLength(DWORD l) { if (l > maxLen) return E_INVALIDARG; len = l; return S_OK; }
  STDMETHODIMP GetMaxLength(DWORD* l) { *l = maxLen; return S_OK; }
  STDMETHODIMP GetBufferAndLength(BYTE** b, DWORD* l) { if (b) *b = data; if (l) *l = len; return S_OK; }
  STDMETHODIMP QueryInterface(REFIID iid, void** ppv) {
    if (iid == IID_IUnknown || iid == IID_IMediaBuffer) { *ppv = this; AddRef(); return S_OK; }
    return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&ref); }
  STDMETHODIMP_(ULONG) Release() { LONG r = InterlockedDecrement(&ref); if (!r) delete this; return r; }
};

// ---- stdin reader: far-end PCM16 @ 24 kHz → ring. fd 3 reader: 'f' → flush.
static void stdinThread() {
  _setmode(_fileno(stdin), _O_BINARY);
  std::vector<int16_t> chunk(2048);
  while (g_running) {
    size_t got = fread(chunk.data(), 1, chunk.size() * 2, stdin);
    if (got == 0) { logln("stdin EOF"); break; }
    g_far.write(chunk.data(), got / 2);
  }
}
static void controlThread() {
  // Node opens fd 3 as a pipe; a 'f' byte means barge-in flush.
  FILE* ctl = _fdopen(3, "rb");          // VERIFY: fd 3 mapping on Windows child stdio
  if (!ctl) return;
  int c;
  while (g_running && (c = fgetc(ctl)) != EOF) {
    if (c == 'f') g_far.clear();
  }
}

// ---- WASAPI render of the far-end to the default endpoint (= the AEC reference).
static int renderThread() {
  IMMDeviceEnumerator* en = nullptr;
  IMMDevice* dev = nullptr;
  IAudioClient* ac = nullptr;
  IAudioRenderClient* rc = nullptr;
  WAVEFORMATEX* mix = nullptr;
  HR(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void**)&en), "MMDeviceEnumerator");
  HR(en->GetDefaultAudioEndpoint(eRender, eConsole, &dev), "GetDefaultAudioEndpoint(render)");
  HR(dev->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&ac), "Activate IAudioClient");
  HR(ac->GetMixFormat(&mix), "GetMixFormat");
  // VERIFY: shared-mode renders at the device mix format (often 48 kHz float). We
  // resample 24 kHz PCM16 → mix below; this assumes float32 mix output.
  REFERENCE_TIME dur = 2 * 10000000LL; // 200 ms buffer (hns)
  HR(ac->Initialize(AUDCLNT_SHAREMODE_SHARED, 0, dur, 0, mix, nullptr), "AudioClient::Initialize");
  UINT32 bufFrames = 0;
  HR(ac->GetBufferSize(&bufFrames), "GetBufferSize");
  HR(ac->GetService(__uuidof(IAudioRenderClient), (void**)&rc), "GetService(render)");
  HR(ac->Start(), "AudioClient::Start");

  const int ch = mix->nChannels;
  const bool isFloat = (mix->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) ||
    (mix->wFormatTag == WAVE_FORMAT_EXTENSIBLE /* VERIFY subformat */);
  while (g_running) {
    UINT32 padding = 0;
    if (FAILED(ac->GetCurrentPadding(&padding))) break;
    UINT32 avail = bufFrames - padding;
    if (avail == 0) { Sleep(5); continue; }
    // Pull `avail` output frames worth of 24 kHz mono, resample to mix rate.
    size_t srcN = (size_t)((double)avail * OUT_RATE / mix->nSamplesPerSec) + 1;
    std::vector<int16_t> src(srcN);
    g_far.read(src.data(), srcN);
    std::vector<int16_t> up = resample(src.data(), srcN, OUT_RATE, mix->nSamplesPerSec);
    BYTE* out = nullptr;
    if (FAILED(rc->GetBuffer(avail, &out))) break;
    for (UINT32 i = 0; i < avail; i++) {
      int16_t s = (i < up.size()) ? up[i] : 0;
      for (int c = 0; c < ch; c++) {
        if (isFloat) ((float*)out)[i * ch + c] = s / 32768.0f;
        else ((int16_t*)out)[i * ch + c] = s;     // VERIFY: handle non-16-bit PCM mix formats
      }
    }
    rc->ReleaseBuffer(avail, 0);
    Sleep(5);
  }
  ac->Stop();
  return 0;
}

int main() {
  HR(CoInitializeEx(nullptr, COINIT_MULTITHREADED), "CoInitializeEx");

  // ---- Voice Capture DMO (AEC), source mode.
  IMediaObject* dmo = nullptr;
  IPropertyStore* ps = nullptr;
  HR(CoCreateInstance(CLSID_CWMAudioAEC, nullptr, CLSCTX_INPROC_SERVER, IID_IMediaObject, (void**)&dmo), "CoCreateInstance(CWMAudioAEC)");
  HR(dmo->QueryInterface(IID_IPropertyStore, (void**)&ps), "QI IPropertyStore");

  PROPVARIANT v;
  PropVariantInit(&v);
  v.vt = VT_I4; v.lVal = 0 /* SINGLE_CHANNEL_AEC */;            // MFPKEY_WMAAECMA_SYSTEM_MODE
  HR(ps->SetValue(MFPKEY_WMAAECMA_SYSTEM_MODE, v), "set SYSTEM_MODE");
  PropVariantClear(&v);
  v.vt = VT_BOOL; v.boolVal = VARIANT_TRUE;                     // source mode: DMO owns capture+sync
  HR(ps->SetValue(MFPKEY_WMAAECMA_DMO_SOURCE_MODE, v), "set DMO_SOURCE_MODE");
  PropVariantClear(&v);
  v.vt = VT_BOOL; v.boolVal = VARIANT_TRUE;                     // AEC on
  HR(ps->SetValue(MFPKEY_WMAAECMA_FEATURE_MODE, v), "set FEATURE_MODE");
  PropVariantClear(&v);
  // VERIFY: device indices. -1/-1 selects system defaults on many systems; otherwise
  // enumerate mic+speaker endpoints and pack (render<<16)|capture into DEVICE_INDEXES.
  v.vt = VT_I4; v.lVal = (int)0xFFFFFFFF;
  ps->SetValue(MFPKEY_WMAAECMA_DEVICE_INDEXES, v);
  PropVariantClear(&v);

  // Output type: 16 kHz mono PCM16.
  WAVEFORMATEX wf{};
  wf.wFormatTag = WAVE_FORMAT_PCM; wf.nChannels = 1; wf.nSamplesPerSec = DMO_RATE;
  wf.wBitsPerSample = 16; wf.nBlockAlign = 2; wf.nAvgBytesPerSec = DMO_RATE * 2; wf.cbSize = 0;
  DMO_MEDIA_TYPE mt{};
  HR(MoInitMediaType(&mt, sizeof(WAVEFORMATEX)), "MoInitMediaType");
  mt.majortype = MEDIATYPE_Audio; mt.subtype = MEDIASUBTYPE_PCM;
  mt.formattype = FORMAT_WaveFormatEx; mt.bFixedSizeSamples = TRUE;
  mt.lSampleSize = 2; mt.cbFormat = sizeof(WAVEFORMATEX);
  memcpy(mt.pbFormat, &wf, sizeof(WAVEFORMATEX));
  HR(dmo->SetOutputType(0, &mt, 0), "SetOutputType");
  MoFreeMediaType(&mt);

  logln("VoiceCapture DMO AEC started (source mode, 16kHz). stdin=far-end PCM16@24k, stdout=clean mic PCM16@24k.");

  _setmode(_fileno(stdout), _O_BINARY);
  std::thread tin(stdinThread);
  std::thread tctl(controlThread);
  std::thread tren(renderThread);

  // ---- Capture loop: pull echo-cancelled mic @ 16 kHz, resample to 24 kHz, write stdout.
  const DWORD CAP = DMO_RATE / 5 * 2; // ~200 ms @ 16k, 2 bytes/sample
  MediaBuffer* mb = new MediaBuffer(CAP);
  DMO_OUTPUT_DATA_BUFFER db{};
  db.pBuffer = mb;
  while (g_running) {
    DWORD status = 0;
    mb->SetLength(0);
    HRESULT hr = dmo->ProcessOutput(0, 1, &db, &status);
    if (hr == S_FALSE) { Sleep(5); continue; }   // no data yet
    if (FAILED(hr)) { fprintf(stderr, "ProcessOutput hr=0x%08lx\n", hr); break; }
    BYTE* bytes = nullptr; DWORD blen = 0;
    mb->GetBufferAndLength(&bytes, &blen);
    if (blen >= 2) {
      auto up = resample((int16_t*)bytes, blen / 2, DMO_RATE, OUT_RATE);
      fwrite(up.data(), 2, up.size(), stdout);
      fflush(stdout);
    }
  }

  g_running = false;
  tin.join(); tctl.join(); tren.join();
  mb->Release();
  CoUninitialize();
  return 0;
}
