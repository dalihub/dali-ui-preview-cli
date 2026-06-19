/*
 * renderConfig.test.ts — unit tests for the M5 render-config resolution +
 * metadata echo (F5.1 dimension/theme math, F5.2 root.meta echo).
 *
 * Pure functions over plain objects: no docker / network / compiler. `cli` is
 * importable without side effects (its `main()` auto-run is guarded by
 * `require.main === module`).
 */

import { expect } from 'chai';
import { resolveRenderConfig, attachMeta, RenderArgs, RenderConfig } from '../../cli';
import { MinimalNode } from '../../treeModel';

/** Build a RenderArgs with only the M5 flags that matter set. */
function args(over: Partial<RenderArgs>): RenderArgs {
    return over as RenderArgs;
}

describe('M5 render config (F5.1) + meta echo (F5.2)', () => {
    describe('resolveRenderConfig', () => {
        it('applies the defaults (1920x1080 / dark / dpr 1) when no flags are given', () => {
            const c = resolveRenderConfig(args({}));
            expect(c.resolution).to.deep.equal({ w: 1920, h: 1080 });
            expect(c.theme).to.equal('dark');
            expect(c.dpr).to.equal(1);
            expect(c.deviceWidth).to.equal(1920);
            expect(c.deviceHeight).to.equal(1080);
            expect(c.backgroundColor).to.equal('Dali::Color::BLACK');
        });

        it('passes the logical resolution through unscaled at dpr 1', () => {
            const c = resolveRenderConfig(args({ resolution: { w: 800, h: 480 } }));
            expect(c.resolution).to.deep.equal({ w: 800, h: 480 });
            expect(c.deviceWidth).to.equal(800);
            expect(c.deviceHeight).to.equal(480);
        });

        it('scales the device dimensions by dpr (400x300 @ dpr 2 → 800x600)', () => {
            const c = resolveRenderConfig(args({ resolution: { w: 400, h: 300 }, dpr: 2 }));
            // Logical resolution is echoed UNSCALED; device dims are scaled.
            expect(c.resolution).to.deep.equal({ w: 400, h: 300 });
            expect(c.dpr).to.equal(2);
            expect(c.deviceWidth).to.equal(800);
            expect(c.deviceHeight).to.equal(600);
        });

        it('rounds fractional device dimensions to whole pixels', () => {
            const c = resolveRenderConfig(args({ resolution: { w: 401, h: 301 }, dpr: 1.5 }));
            expect(c.deviceWidth).to.equal(Math.round(401 * 1.5)); // 602 (601.5 → 602)
            expect(c.deviceHeight).to.equal(Math.round(301 * 1.5)); // 452 (451.5 → 452)
        });

        it('maps the light theme to a distinct (white) background color', () => {
            const dark = resolveRenderConfig(args({ theme: 'dark' }));
            const light = resolveRenderConfig(args({ theme: 'light' }));
            expect(dark.backgroundColor).to.equal('Dali::Color::BLACK');
            expect(light.backgroundColor).to.equal('Dali::Color::WHITE');
            expect(light.backgroundColor).to.not.equal(dark.backgroundColor);
        });
    });

    describe('attachMeta', () => {
        it('echoes the EFFECTIVE logical resolution + theme + dpr on root.meta', () => {
            const config: RenderConfig = resolveRenderConfig(
                args({ resolution: { w: 800, h: 480 }, theme: 'light', dpr: 1 }),
            );
            const root: MinimalNode = { type: 'Layer', children: [] };
            attachMeta(root, config);
            expect(root.meta).to.deep.equal({ resolution: { w: 800, h: 480 }, theme: 'light', dpr: 1 });
        });

        it('echoes the LOGICAL (pre-dpr) resolution, not the scaled device size', () => {
            const config = resolveRenderConfig(args({ resolution: { w: 400, h: 300 }, dpr: 2 }));
            const root: MinimalNode = { type: 'Layer' };
            attachMeta(root, config);
            // meta.resolution is logical 400x300 even though it renders at 800x600.
            expect(root.meta).to.deep.equal({ resolution: { w: 400, h: 300 }, theme: 'dark', dpr: 2 });
        });

        it('echoes the defaults when no flags were passed', () => {
            const root: MinimalNode = { type: 'Layer' };
            attachMeta(root, resolveRenderConfig(args({})));
            expect(root.meta).to.deep.equal({ resolution: { w: 1920, h: 1080 }, theme: 'dark', dpr: 1 });
        });

        it('does not disturb existing root fields (additive)', () => {
            const root: MinimalNode = { type: 'Layer', name: 'RootLayer', id: '0', mark: 1 };
            attachMeta(root, resolveRenderConfig(args({})));
            expect(root.type).to.equal('Layer');
            expect(root.name).to.equal('RootLayer');
            expect(root.id).to.equal('0');
            expect(root.mark).to.equal(1);
            expect(root.meta).to.not.equal(undefined);
        });
    });
});
