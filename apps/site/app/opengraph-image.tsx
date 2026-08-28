import { ImageResponse } from 'next/og';

export const alt = 'Arcade — 3D games in your terminal';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{
      alignItems: 'stretch',
      background: '#000',
      color: 'white',
      display: 'flex',
      fontFamily: 'monospace',
      height: '100%',
      padding: 56,
      width: '100%',
    }}>
      <div style={{ border: '1px solid #333', display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'space-between', padding: 52 }}>
        <div style={{ display: 'flex', fontSize: 24 }}>▲ / Arcade</div>
        <div style={{ display: 'flex', fontFamily: 'sans-serif', fontSize: 86, fontWeight: 600, letterSpacing: -5, lineHeight: 1.02, maxWidth: 900 }}>3D games in your terminal.</div>
        <div style={{ color: '#999', display: 'flex', fontSize: 23 }}>TypeScript renderer · terminal UI · model game harness</div>
      </div>
    </div>,
    size,
  );
}
