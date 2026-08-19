import { describe, expect, it } from 'vitest';
import type { Timeline } from './model/types';
import { EMPTY_TIMELINE } from '../state/timeline-model';
import { mergeDocument } from '../store/serialise';
import { SCHEMA_VERSION } from '../store/contract';
import type { TimelineDocument } from '../store/contract';
import { instant } from './time';
import {
  adoptRecord,
  expandPack,
  isInstalled,
  packRecordId,
  packRecords,
  summarise,
  uninstallPack,
} from './packs';
import type { PackBundle } from './packs';

const T1 = '2026-01-01T00:00:00+01:00';
const T2 = '2026-06-01T00:00:00+02:00';
const T3 = '2027-01-01T00:00:00+01:00';

function bundle(version = '1.0.0', title = 'the fall of Constantinople'): PackBundle {
  return {
    id: 'pack.test',
    name: 'Test pack',
    version,
    license: 'CC0-1.0',
    events: [
      { key: 'fall', title, when: instant(1453, 5, 29), tags: ['tag.theme.war'] },
      { key: 'press', title: 'Gutenberg prints the Bible', when: instant(1455), tags: [] },
    ],
    eras: [
      {
        key: 'era',
        name: 'the late middle ages',
        when: instant(1400),
        kind: 'canonical',
        tags: [],
      },
    ],
    connections: [{ key: 'link', from: 'fall', to: 'press', note: 'Greek manuscripts.', tags: [] }],
  };
}

/** Installs through the same merge rule the app uses. */
function install(timeline: Timeline, pack: PackBundle, now: string): Timeline {
  const expanded = expandPack(pack, { now });
  const document: TimelineDocument = {
    schema_version: SCHEMA_VERSION,
    exported_at: now,
    events: expanded.events,
    connections: expanded.connections,
    tags: [],
    eras: expanded.eras,
    packs: [expanded.pack],
  };
  return mergeDocument(timeline, document).timeline;
}

describe('expandPack', () => {
  it('stamps every record with the pack id — the mechanism everything else rests on', () => {
    const { events, eras, connections, pack } = expandPack(bundle(), { now: T1 });
    for (const record of [...events, ...eras, ...connections]) {
      expect(record.pack).toBe('pack.test');
      expect(record.created_at).toBe(T1);
      expect(record.updated_at).toBe(T1);
    }
    expect(pack.license).toBe('CC0-1.0');
    expect(pack.installed_at).toBe(T1);
  });

  it('marks provenance as pack, not manual', () => {
    const { events } = expandPack(bundle(), { now: T1 });
    expect(events[0]?.provenance).toEqual({ kind: 'pack', ref: 'pack.test' });
  });

  it('derives ids from the pack and key, so an upgrade lands on the same records', () => {
    const first = expandPack(bundle('1.0.0'), { now: T1 });
    const second = expandPack(bundle('2.0.0'), { now: T3 });
    expect(first.events.map((e) => e.id)).toEqual(second.events.map((e) => e.id));
    expect(first.events[0]?.id).toBe(packRecordId('pack.test', 'fall'));
  });

  it('resolves connection endpoints to record ids', () => {
    const { connections, events } = expandPack(bundle(), { now: T1 });
    expect(connections[0]?.from).toBe(events[0]?.id);
    expect(connections[0]?.to).toBe(events[1]?.id);
  });

  it('drops a connection referencing a key the bundle does not define', () => {
    // Installing it anyway would leave an arc terminating in nothing.
    const broken = bundle();
    broken.connections = [{ key: 'bad', from: 'fall', to: 'nowhere', note: '', tags: [] }];
    expect(expandPack(broken, { now: T1 }).connections).toHaveLength(0);
  });

  it('leaves learned_at unset — a pack cannot claim you learned anything', () => {
    const { events } = expandPack(bundle(), { now: T1 });
    expect(events[0]?.learned_at).toBeUndefined();
  });
});

describe('install', () => {
  it('adds the records and registers the pack', () => {
    const after = install(EMPTY_TIMELINE, bundle(), T1);
    expect(after.events).toHaveLength(2);
    expect(after.eras).toHaveLength(1);
    expect(after.connections).toHaveLength(1);
    expect(isInstalled(after, 'pack.test')).toBe(true);
  });

  it('is idempotent — installing twice changes nothing', () => {
    const once = install(EMPTY_TIMELINE, bundle(), T1);
    const twice = install(once, bundle(), T1);
    expect(twice.events).toHaveLength(2);
    expect(twice.packs).toHaveLength(1);
  });
});

describe('upgrade', () => {
  it('updates records the user has not touched', () => {
    const installed = install(EMPTY_TIMELINE, bundle('1.0.0'), T1);
    const upgraded = install(installed, bundle('2.0.0', 'the fall of Constantinople (revised)'), T3);

    const fall = upgraded.events.find((e) => e.id === packRecordId('pack.test', 'fall'));
    expect(fall?.title).toBe('the fall of Constantinople (revised)');
    expect(upgraded.events).toHaveLength(2);
  });

  /**
   * The rule the whole feature turns on (§5). Without it every upgrade quietly
   * rewrites the user's work, because the new bundle always carries a newer
   * timestamp than their edit.
   */
  it('never overwrites a record the user has adopted', () => {
    const installed = install(EMPTY_TIMELINE, bundle('1.0.0'), T1);
    const index = installed.events.findIndex((e) => e.id === packRecordId('pack.test', 'fall'));
    const adopted = adoptRecord(installed.events[index] as never, T2);
    expect(adopted).not.toBeNull();

    const mine = { ...(adopted as never as Record<string, unknown>), title: 'my own version' };
    const edited: Timeline = {
      ...installed,
      events: installed.events.map((e, i) => (i === index ? (mine as never) : e)),
    };

    const upgraded = install(edited, bundle('2.0.0', 'the fall of Constantinople (revised)'), T3);
    const fall = upgraded.events.find((e) => e.id === packRecordId('pack.test', 'fall'));
    expect(fall?.title).toBe('my own version');
    expect(fall?.pack).toBeUndefined();
  });
});

describe('adoptRecord', () => {
  it('clears the pack and switches provenance to manual, keeping the origin', () => {
    const { events } = expandPack(bundle(), { now: T1 });
    const adopted = adoptRecord(events[0] as never, T2) as unknown as {
      pack?: string;
      provenance: { kind: string; ref?: string };
      updated_at: string;
    };
    expect(adopted.pack).toBeUndefined();
    expect(adopted.provenance.kind).toBe('manual');
    expect(adopted.provenance.ref).toBe('pack.test');
    expect(adopted.updated_at).toBe(T2);
  });

  it('returns null for a record that is already the user’s own', () => {
    expect(adoptRecord({ id: 'x', provenance: { kind: 'manual' } } as never, T2)).toBeNull();
  });
});

describe('uninstallPack', () => {
  it('takes away everything the pack still owns', () => {
    const installed = install(EMPTY_TIMELINE, bundle(), T1);
    const after = uninstallPack(installed, 'pack.test');
    expect(after.events).toHaveLength(0);
    expect(after.eras).toHaveLength(0);
    expect(after.connections).toHaveLength(0);
    expect(isInstalled(after, 'pack.test')).toBe(false);
  });

  it('removes rather than tombstones, so reinstalling works', () => {
    // A tombstone would carry a newer timestamp than the bundle, and the
    // reinstall would merge into it and restore nothing.
    const installed = install(EMPTY_TIMELINE, bundle(), T1);
    const removed = uninstallPack(installed, 'pack.test');
    const again = install(removed, bundle(), T3);
    expect(again.events).toHaveLength(2);
    expect(isInstalled(again, 'pack.test')).toBe(true);
  });

  it('keeps adopted records — that is what adoption is for', () => {
    const installed = install(EMPTY_TIMELINE, bundle(), T1);
    const index = installed.events.findIndex((e) => e.id === packRecordId('pack.test', 'fall'));
    const adopted = adoptRecord(installed.events[index] as never, T2);
    const edited: Timeline = {
      ...installed,
      events: installed.events.map((e, i) => (i === index ? (adopted as never) : e)),
    };

    const after = uninstallPack(edited, 'pack.test');
    expect(after.events).toHaveLength(1);
    expect(after.events[0]?.title).toBe('the fall of Constantinople');
  });

  it('removes a personal connection whose endpoint is leaving', () => {
    // The alternative is an arc into a hole.
    const installed = install(EMPTY_TIMELINE, bundle(), T1);
    const mine: Timeline = {
      ...installed,
      events: [
        ...installed.events,
        {
          id: 'mine',
          created_at: T2,
          updated_at: T2,
          title: 'something of my own',
          when: instant(1500),
          tags: [],
          provenance: { kind: 'manual' },
        },
      ],
      connections: [
        ...installed.connections,
        {
          id: 'mine-link',
          created_at: T2,
          updated_at: T2,
          from: 'mine',
          to: packRecordId('pack.test', 'press'),
          note: 'mine',
          tags: [],
          provenance: { kind: 'manual' },
        },
      ],
    };

    const after = uninstallPack(mine, 'pack.test');
    expect(after.events.map((e) => e.id)).toEqual(['mine']);
    expect(after.connections).toHaveLength(0);
  });

  it('leaves tags alone, since packs share them by id', () => {
    const withTags: Timeline = {
      ...install(EMPTY_TIMELINE, bundle(), T1),
      tags: [{ id: 'tag.theme.war', created_at: T1, updated_at: T1, name: 'war', kind: 'theme' }],
    };
    expect(uninstallPack(withTags, 'pack.test').tags).toHaveLength(1);
  });
});

describe('packRecords and summarise', () => {
  it('reports what a pack still owns', () => {
    const installed = install(EMPTY_TIMELINE, bundle(), T1);
    const owned = packRecords(installed, 'pack.test');
    expect(owned.events).toHaveLength(2);
    expect(owned.eras).toHaveLength(1);
  });

  it('flags an upgrade when the catalogue is ahead of what is installed', () => {
    const installed = install(EMPTY_TIMELINE, bundle('1.0.0'), T1);
    const [summary] = summarise(installed, [bundle('2.0.0')]);
    expect(summary?.upgradable).toBe(true);
    expect(summary?.events).toBe(2);

    const [current] = summarise(installed, [bundle('1.0.0')]);
    expect(current?.upgradable).toBe(false);
  });

  it('reports a pack that is not installed at all', () => {
    const [summary] = summarise(EMPTY_TIMELINE, [bundle()]);
    expect(summary?.installed).toBeUndefined();
    expect(summary?.upgradable).toBe(false);
  });
});
