import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { assertFrameSignature } from '../frame-signature.ts';
import { ChessGameScene } from './scene.ts';

test('authored Chess traversal preserves direct-raster framebuffer baselines', () => {
  const scene = new ChessGameScene();
  const cases: { name: string; mutate(): void; expected: string }[] = [
    {
      name: 'default',
      mutate: () => {},
      expected: 'CgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsODw4PCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOIxoUMiQaNiYaNiYaNSYbJBsVCgsOCgsOCgsOCgsOCgsOCwwOVk1Eal5Tal1QbmFUbWBUUUhACwwPCgsOCgsOCgsOCgsOIiIiZmJdaWVfaWVfbmtlaGReaWZgIyIiCgsOCgsOCgsOFRYYjYqDko+HlJCIioeAlpKKlZKKoJyUl5SNGRkbCgsOCgsOGxoad3RukIyFeHRulpKKhYF6kY2GgX13kI2FIyIhCgsOCgsODxASERETERETERETERETERETERETERETERETDxASCgsO',
    },
    {
      name: 'orbit',
      mutate: () => scene.orbit(7, -3),
      expected: 'CgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCwwOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOGhQSLyEXHhcTNCQZMCIYGBQSCgsOCgsOCgsOCgsOCgsODAwPXVBFa1lIaVtNcF1Nb2JVQzw2CgsOCgsOCgsOCgsOCgsOIyIiZmJda2hibmpkeHRtd3NtbmtlOjk3CwwPCgsOCgsOCgsOhYN8lpKLjIiBjoqDjoqDmJSMpaKZop+WPz8+CgsOCgsOExMUfXpzkY6GfXpzgX53endwcW5oYl9aW1hUNjQyCgsOCgsOERETFBQVEhIUEBASDQ4QCwwPCgsOCgsOCgsOCgsOCgsO',
    },
    {
      name: 'zoom-pan',
      mutate: () => {
        scene.zoomBy(0.82);
        scene.pan(9, -4);
      },
      expected: 'CgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsOCgsODAwOEQ8QGBMRDQ0PCgsOCgsOCgsOCgsOCgsOCgsODAwPQi0dQCwdMyYcQi4eUzkjPSsdCgsOCgsOCgsOCgsOCgsOKScnbl5QbV9RaF1Sb2NXbGBTaF9VJiUlCgsOCgsOCgsODA0PVVJNYV1YbWljZWFcaWVfeXVvb2tlYFxXLy4uCgsOCwwPV1ZTbWpkj4uEj4uElJCJh4N8ramgr6yiramgoJyUbmxoIyMkn5yUnpuTiYZ/op6Wko6HiYZ/op+Xq6ifk5CIp6Oak5CIIiAgi4eAe3dxeHVucW1namdhXltVVFFNT01JODYzLy0rMC4t',
    },
  ];
  for (const entry of cases) {
    entry.mutate();
    const target = new RenderTarget(280, 192);
    scene.renderScene(target, 0);
    assertFrameSignature(target, entry.expected, entry.name);
  }
});
