import { toDocSlug } from '../src/mapper';

describe('toDocSlug (Hash Strategy)', () => {
    it('should generate 8-char md5 hash for any path', () => {
        expect(toDocSlug('中文名.md')).toMatch(/^[a-f0-9]{8}$/);
        expect(toDocSlug('getting-started.md')).toMatch(/^[a-f0-9]{8}$/);
        expect(toDocSlug('docs/guide/advanced.md')).toMatch(/^[a-f0-9]{8}$/);
    });

    it('should consistently generate the same hash for the same path', () => {
        const hash1 = toDocSlug('docs/abc.md');
        const hash2 = toDocSlug('docs/abc.md');
        expect(hash1).toEqual(hash2);
    });
});
