import { ImageResponse } from 'next/og';

export const alt = 'Arcade — build worlds inside text';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{
      alignItems: 'stretch',
      background: '#050609',
      color: 'white',
      display: 'flex',
      fontFamily: 'monospace',
      height: '100%',
      padding: 56,
      width: '100%',
    }}>
      <div style={{ border: '1px solid #2b303b', display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'space-between', padding: 52 }}>
        <div style={{ color: '#58d4ec', display: 'flex', fontSize: 24, letterSpacing: 4 }}>▲ / ARCADE</div>
        <div style={{ display: 'flex', fontSize: 74, fontWeight: 700, letterSpacing: -5, lineHeight: 1.02, maxWidth: 820 }}>Build worlds inside text.</div>
        <div style={{ color: '#9aa2b3', display: 'flex', fontSize: 23 }}>CPU 3D renderer · retained TUI · agent-playable games</div>
      </div>
    </div>,
    size,
  );
}
