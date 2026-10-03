import { describe, expect, it } from 'vitest';
import { ASPECTS, IMAGE_SIZES, VIDEO_SIZES } from './presets';

describe('aspect sizes', () => {
  const tables = { image: IMAGE_SIZES, fast: VIDEO_SIZES.fast, hd: VIDEO_SIZES.hd };

  it.each(ASPECTS)('%s has a 16 px-aligned size close to its ratio in every table', (aspect) => {
    const [rw, rh] = aspect.split(':').map(Number);
    for (const [name, table] of Object.entries(tables)) {
      const size = table[aspect];
      expect(size, `${name} ${aspect}`).toBeDefined();
      expect(size.width % 16, `${name} ${aspect} width`).toBe(0);
      expect(size.height % 16, `${name} ${aspect} height`).toBe(0);
      expect(Math.abs(size.width / size.height / (rw / rh) - 1), `${name} ${aspect} ratio`).toBeLessThan(0.03);
    }
  });
});
