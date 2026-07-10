import { expect } from 'chai';
import {
    parseTagFromLocation,
    isNewerVersion,
    shouldCheckNow,
    maybeNotifyUpdate,
    UPGRADE_SPEC,
    DISABLE_ENV,
} from '../../updateCheck';

describe('updateCheck.parseTagFromLocation', () => {
    it('extracts the tag from a releases/tag redirect', () => {
        expect(parseTagFromLocation('https://github.com/dalihub/dali-ui-preview-cli/releases/tag/v0.12.0')).to.equal('v0.12.0');
    });
    it('returns null with no /tag/ segment or empty input', () => {
        expect(parseTagFromLocation('https://github.com/x/y/releases')).to.equal(null);
        expect(parseTagFromLocation(undefined)).to.equal(null);
    });
});

describe('updateCheck.isNewerVersion', () => {
    it('true when latest is higher; numeric (10 > 9)', () => {
        expect(isNewerVersion('0.12.0', '0.11.3')).to.equal(true);
        expect(isNewerVersion('0.11.10', '0.11.9')).to.equal(true);
        expect(isNewerVersion('v0.12.0', '0.11.3')).to.equal(true);
    });
    it('false when equal/older/unparseable (fail safe)', () => {
        expect(isNewerVersion('0.11.3', '0.11.3')).to.equal(false);
        expect(isNewerVersion('0.11.2', '0.11.3')).to.equal(false);
        expect(isNewerVersion('garbage', '0.11.3')).to.equal(false);
    });
});

describe('updateCheck.shouldCheckNow (once/day throttle)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    it('checks when there is no prior stamp', () => {
        expect(shouldCheckNow(1_000_000, null)).to.equal(true);
    });
    it('skips within the window, checks after a day', () => {
        expect(shouldCheckNow(DAY, DAY - 1)).to.equal(false);
        expect(shouldCheckNow(2 * DAY, DAY - 1)).to.equal(true);
    });
});

describe('updateCheck.maybeNotifyUpdate', () => {
    afterEach(() => { delete process.env[DISABLE_ENV]; });

    const base = (over: any = {}) => ({
        now: 1_000_000_000_000,
        readLastCheck: () => null,
        recordCheck: () => { /* no file I/O in tests */ },
        ...over,
    });

    it('notifies (stderr) when a newer release exists', async () => {
        const logs: string[] = [];
        await maybeNotifyUpdate('0.11.3', base({ fetchLatest: async () => '0.12.0', log: (m: string) => logs.push(m) }));
        expect(logs.length).to.equal(1);
        expect(logs[0]).to.contain('0.12.0');
        expect(logs[0]).to.contain(UPGRADE_SPEC);
    });

    it('is silent when already up to date', async () => {
        const logs: string[] = [];
        await maybeNotifyUpdate('0.12.0', base({ fetchLatest: async () => '0.12.0', log: (m: string) => logs.push(m) }));
        expect(logs.length).to.equal(0);
    });

    it('is silent within the throttle window (no fetch)', async () => {
        let fetched = false;
        const logs: string[] = [];
        await maybeNotifyUpdate('0.11.3', base({
            now: 1000, readLastCheck: () => 900, // <1 day ago
            fetchLatest: async () => { fetched = true; return '0.12.0'; },
            log: (m: string) => logs.push(m),
        }));
        expect(fetched).to.equal(false);
        expect(logs.length).to.equal(0);
    });

    it('is silent (no fetch) when disabled by env', async () => {
        process.env[DISABLE_ENV] = '1';
        let fetched = false;
        await maybeNotifyUpdate('0.11.3', base({ fetchLatest: async () => { fetched = true; return '0.12.0'; } }));
        expect(fetched).to.equal(false);
    });

    it('never throws when the fetch rejects (fail-silent)', async () => {
        await maybeNotifyUpdate('0.11.3', base({ fetchLatest: async () => { throw new Error('offline'); } }));
    });
});
