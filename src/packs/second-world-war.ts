/**
 * The Second World War, as an installable pack (docs/design.md §5).
 *
 * Deliberately a *skeleton*, not a chronicle: about forty events, chosen so the
 * shape of the war is legible rather than so nothing is missing. A pack that
 * tried to be complete would bury the user's own events under it, which is the
 * failure mode §5 exists to avoid.
 *
 * Dates are Gregorian and refer to the event's start where a range is not given.
 * Tags use the built-in namespaced ids (D20), so pack events filter alongside
 * the user's own rather than creating a second Europe.
 */

import { fromGregorian, instant, interval } from '../core/time';
import type { PackBundle } from '../core/packs';
import {
  R_AFRICA,
  R_AMERICAS,
  R_ASIA,
  R_BRITAIN,
  R_CHINA,
  R_FRANCE,
  R_GERMANY,
  R_ITALY,
  R_JAPAN,
  R_MEDITERRANEAN,
  R_NORDICS,
  R_RUSSIA,
  T_POLITICS,
  T_SCIENCE,
  T_TECHNOLOGY,
  T_WAR,
} from '../core/model/builtin-tags';

const day = (year: number, month: number, date: number) => instant(year, month, date);
const span = (from: [number, number, number], to: [number, number, number]) =>
  interval(fromGregorian(...from), fromGregorian(...to));

export const SECOND_WORLD_WAR: PackBundle = {
  id: 'pack.second-world-war',
  name: 'The Second World War',
  version: '1.0.0',
  license: 'CC0-1.0',
  description:
    'About forty turning points, 1937–1946, with the fronts kept distinct: Europe, the East, ' +
    'the Pacific, and the war against civilians.',

  events: [
    {
      key: 'marco-polo-bridge',
      title: 'the Marco Polo Bridge incident opens the Second Sino-Japanese War',
      when: day(1937, 7, 7),
      tags: [T_WAR, R_CHINA, R_JAPAN, R_ASIA],
      notes:
        'Where the war starts depends on where you stand. For China this is the beginning, ' +
        'two years before Poland.',
    },
    {
      key: 'invasion-of-poland',
      title: 'Germany invades Poland',
      when: day(1939, 9, 1),
      tags: [T_WAR, R_GERMANY],
    },
    {
      key: 'britain-france-declare',
      title: 'Britain and France declare war on Germany',
      when: day(1939, 9, 3),
      tags: [T_WAR, T_POLITICS, R_BRITAIN, R_FRANCE],
    },
    {
      key: 'soviet-invasion-poland',
      title: 'the Soviet Union invades eastern Poland',
      when: day(1939, 9, 17),
      tags: [T_WAR, R_RUSSIA],
      notes: 'Under the secret protocol of the Molotov–Ribbentrop pact, signed three weeks earlier.',
    },
    {
      key: 'winter-war',
      title: 'the Winter War',
      when: span([1939, 11, 30], [1940, 3, 14]),
      tags: [T_WAR, R_RUSSIA, R_NORDICS],
    },
    {
      key: 'invasion-denmark-norway',
      title: 'Germany invades Denmark and Norway',
      when: day(1940, 4, 9),
      tags: [T_WAR, R_GERMANY, R_NORDICS],
    },
    {
      key: 'invasion-west',
      title: 'Germany invades France and the Low Countries',
      when: day(1940, 5, 10),
      tags: [T_WAR, R_GERMANY, R_FRANCE],
    },
    {
      key: 'dunkirk',
      title: 'the evacuation from Dunkirk',
      when: span([1940, 5, 26], [1940, 6, 5]),
      tags: [T_WAR, R_BRITAIN, R_FRANCE],
    },
    {
      key: 'fall-of-france',
      title: 'France signs the armistice at Compiègne',
      when: day(1940, 6, 22),
      tags: [T_WAR, T_POLITICS, R_FRANCE],
    },
    {
      key: 'battle-of-britain',
      title: 'the Battle of Britain',
      when: span([1940, 7, 10], [1940, 11, 1]),
      tags: [T_WAR, R_BRITAIN],
    },
    {
      key: 'the-blitz',
      title: 'the Blitz',
      when: span([1940, 9, 7], [1941, 5, 12]),
      tags: [T_WAR, R_BRITAIN],
    },
    {
      key: 'balkans',
      title: 'Germany invades Yugoslavia and Greece',
      when: day(1941, 4, 6),
      tags: [T_WAR, R_GERMANY, R_MEDITERRANEAN],
    },
    {
      key: 'barbarossa',
      title: 'Operation Barbarossa: Germany invades the Soviet Union',
      when: day(1941, 6, 22),
      tags: [T_WAR, R_GERMANY, R_RUSSIA],
    },
    {
      key: 'siege-of-leningrad',
      title: 'the siege of Leningrad',
      when: span([1941, 9, 8], [1944, 1, 28]),
      tags: [T_WAR, R_RUSSIA],
      notes: 'Eight hundred and seventy-two days. Something over a million civilians died in it.',
    },
    {
      key: 'pearl-harbor',
      title: 'the attack on Pearl Harbor',
      when: day(1941, 12, 7),
      tags: [T_WAR, R_JAPAN, R_AMERICAS],
    },
    {
      key: 'germany-declares-us',
      title: 'Germany declares war on the United States',
      when: day(1941, 12, 11),
      tags: [T_WAR, T_POLITICS, R_GERMANY, R_AMERICAS],
      notes:
        'Not required by any treaty Germany had signed, and the single decision that turned two ' +
        'regional wars into one global one.',
    },
    {
      key: 'wannsee',
      title: 'the Wannsee conference',
      when: day(1942, 1, 20),
      tags: [T_POLITICS, R_GERMANY],
      notes: 'Ninety minutes to coordinate the machinery of an extermination already under way.',
    },
    {
      key: 'fall-of-singapore',
      title: 'the fall of Singapore',
      when: day(1942, 2, 15),
      tags: [T_WAR, R_JAPAN, R_BRITAIN, R_ASIA],
    },
    {
      key: 'midway',
      title: 'the Battle of Midway',
      when: span([1942, 6, 4], [1942, 6, 8]),
      tags: [T_WAR, R_JAPAN, R_AMERICAS],
    },
    {
      key: 'stalingrad',
      title: 'the Battle of Stalingrad',
      when: span([1942, 8, 23], [1943, 2, 3]),
      tags: [T_WAR, R_RUSSIA, R_GERMANY],
    },
    {
      key: 'el-alamein',
      title: 'the second Battle of El Alamein',
      when: span([1942, 10, 23], [1942, 11, 12]),
      tags: [T_WAR, R_AFRICA, R_BRITAIN],
    },
    {
      key: 'warsaw-ghetto-uprising',
      title: 'the Warsaw ghetto uprising',
      when: span([1943, 4, 19], [1943, 5, 17]),
      tags: [T_WAR, T_POLITICS],
    },
    {
      key: 'kursk',
      title: 'the Battle of Kursk',
      when: span([1943, 7, 5], [1943, 8, 24]),
      tags: [T_WAR, R_RUSSIA, R_GERMANY],
      notes: 'The last German offensive in the East. Afterwards the front only moved one way.',
    },
    {
      key: 'italy-surrenders',
      title: 'Italy signs an armistice with the Allies',
      when: day(1943, 9, 8),
      tags: [T_WAR, T_POLITICS, R_ITALY],
    },
    {
      key: 'd-day',
      title: 'the Normandy landings',
      when: day(1944, 6, 6),
      tags: [T_WAR, R_FRANCE, R_BRITAIN, R_AMERICAS],
    },
    {
      key: 'bagration',
      title: 'Operation Bagration destroys Army Group Centre',
      when: span([1944, 6, 22], [1944, 8, 20]),
      tags: [T_WAR, R_RUSSIA, R_GERMANY],
      notes:
        'Larger than Normandy by every measure, and launched three years to the day after ' +
        'Barbarossa. Barely remembered in the West.',
    },
    {
      key: 'liberation-of-paris',
      title: 'the liberation of Paris',
      when: day(1944, 8, 25),
      tags: [T_WAR, R_FRANCE],
    },
    {
      key: 'ardennes',
      title: 'the Ardennes offensive',
      when: span([1944, 12, 16], [1945, 1, 26]),
      tags: [T_WAR, R_GERMANY],
    },
    {
      key: 'yalta',
      title: 'the Yalta conference',
      when: span([1945, 2, 4], [1945, 2, 12]),
      tags: [T_POLITICS, R_RUSSIA, R_BRITAIN, R_AMERICAS],
    },
    {
      key: 'auschwitz-liberated',
      title: 'the Red Army reaches Auschwitz',
      when: day(1945, 1, 27),
      tags: [T_WAR, R_RUSSIA],
    },
    {
      key: 'dresden',
      title: 'the bombing of Dresden',
      when: span([1945, 2, 13], [1945, 2, 16]),
      tags: [T_WAR, R_GERMANY, R_BRITAIN],
    },
    {
      key: 'iwo-jima',
      title: 'the Battle of Iwo Jima',
      when: span([1945, 2, 19], [1945, 3, 27]),
      tags: [T_WAR, R_JAPAN, R_AMERICAS],
    },
    {
      key: 'okinawa',
      title: 'the Battle of Okinawa',
      when: span([1945, 4, 1], [1945, 6, 23]),
      tags: [T_WAR, R_JAPAN, R_AMERICAS],
    },
    {
      key: 'hitler-dies',
      title: 'Hitler kills himself in the Führerbunker',
      when: day(1945, 4, 30),
      tags: [T_POLITICS, R_GERMANY],
    },
    {
      key: 've-day',
      title: 'Germany surrenders unconditionally',
      when: day(1945, 5, 8),
      tags: [T_WAR, T_POLITICS, R_GERMANY],
    },
    {
      key: 'trinity',
      title: 'the Trinity test',
      when: day(1945, 7, 16),
      tags: [T_SCIENCE, T_TECHNOLOGY, T_WAR, R_AMERICAS],
    },
    {
      key: 'potsdam',
      title: 'the Potsdam conference',
      when: span([1945, 7, 17], [1945, 8, 3]),
      tags: [T_POLITICS, R_GERMANY, R_RUSSIA, R_AMERICAS],
    },
    {
      key: 'hiroshima',
      title: 'the atomic bombing of Hiroshima',
      when: day(1945, 8, 6),
      tags: [T_WAR, T_TECHNOLOGY, R_JAPAN, R_AMERICAS],
    },
    {
      key: 'soviet-manchuria',
      title: 'the Soviet Union invades Manchuria',
      when: day(1945, 8, 9),
      tags: [T_WAR, R_RUSSIA, R_JAPAN, R_CHINA],
    },
    {
      key: 'nagasaki',
      title: 'the atomic bombing of Nagasaki',
      when: day(1945, 8, 9),
      tags: [T_WAR, T_TECHNOLOGY, R_JAPAN, R_AMERICAS],
    },
    {
      key: 'japan-surrenders',
      title: 'Japan announces its surrender',
      when: day(1945, 8, 15),
      tags: [T_WAR, T_POLITICS, R_JAPAN],
    },
    {
      key: 'formal-surrender',
      title: 'the formal surrender aboard USS Missouri',
      when: day(1945, 9, 2),
      tags: [T_WAR, T_POLITICS, R_JAPAN, R_AMERICAS],
    },
    {
      key: 'nuremberg',
      title: 'the Nuremberg trials open',
      when: day(1945, 11, 20),
      tags: [T_POLITICS, R_GERMANY],
      notes: 'The first time a court asserted that following orders is not a defence.',
    },
  ],

  eras: [
    {
      key: 'the-war',
      name: 'the Second World War',
      when: span([1939, 9, 1], [1945, 9, 3]),
      kind: 'canonical',
      tags: [T_WAR],
    },
    {
      key: 'eastern-front',
      name: 'the Eastern Front',
      when: span([1941, 6, 22], [1945, 5, 9]),
      kind: 'canonical',
      tags: [T_WAR, R_RUSSIA],
    },
    {
      key: 'pacific-war',
      name: 'the Pacific War',
      when: span([1941, 12, 7], [1945, 9, 3]),
      kind: 'canonical',
      tags: [T_WAR, R_ASIA],
    },
    {
      key: 'the-holocaust',
      name: 'the Holocaust',
      when: span([1941, 6, 1], [1945, 5, 9]),
      kind: 'canonical',
      tags: [T_POLITICS],
      notes:
        'Dated here from the mass shootings that began with Barbarossa. The persecution is older ' +
        'than the extermination, and no date is uncontested.',
    },
  ],

  connections: [
    {
      key: 'pearl-to-us-war',
      from: 'pearl-harbor',
      to: 'germany-declares-us',
      tags: [T_POLITICS],
      note:
        'Pearl Harbor brought the United States into a war with **Japan**. It was Hitler who ' +
        'made it a war with Germany, four days later and under no obligation to.',
    },
    {
      key: 'barbarossa-to-stalingrad',
      from: 'barbarossa',
      to: 'stalingrad',
      tags: [T_WAR],
      note: 'Eighteen months from the deepest advance to the turn.',
    },
    {
      key: 'stalingrad-to-kursk',
      from: 'stalingrad',
      to: 'kursk',
      tags: [T_WAR],
      note:
        'Stalingrad ended the German advance; Kursk ended the German capacity to attack at all. ' +
        'After August 1943 the Eastern Front only moved west.',
    },
    {
      key: 'dday-to-bagration',
      from: 'd-day',
      to: 'bagration',
      tags: [T_WAR],
      note:
        'Sixteen days apart, and coordinated. The Western landing is the one remembered in the ' +
        'West; the Eastern offensive was several times its size.',
    },
    {
      key: 'trinity-to-hiroshima',
      from: 'trinity',
      to: 'hiroshima',
      tags: [T_TECHNOLOGY],
      note: 'Three weeks from the first proof that it worked to its use on a city.',
    },
    {
      key: 'manchuria-to-surrender',
      from: 'soviet-manchuria',
      to: 'japan-surrenders',
      tags: [T_POLITICS],
      note:
        'The Soviet declaration and the second bomb fell on the same day, and historians still ' +
        'argue about which weighed more in Tokyo. Worth holding both.',
    },
    {
      key: 'wannsee-to-auschwitz',
      from: 'wannsee',
      to: 'auschwitz-liberated',
      tags: [T_POLITICS],
      note: 'Three years and a week between the coordination meeting and the gates being opened.',
    },
    {
      key: 'versailles-armistice',
      from: 'fall-of-france',
      to: 'liberation-of-paris',
      tags: [T_WAR, R_FRANCE],
      note:
        'The 1940 armistice was signed in the same railway carriage as the 1918 one, moved to ' +
        'the same clearing for the purpose. Four years later the carriage was gone and so was ' +
        'the occupation.',
    },
    {
      key: 'marco-polo-to-manchuria',
      from: 'marco-polo-bridge',
      to: 'soviet-manchuria',
      tags: [R_ASIA],
      note: 'Eight years of war in China, ended in a week by an army that had not been fighting it.',
    },
    {
      key: 'britain-to-dunkirk',
      from: 'dunkirk',
      to: 'battle-of-britain',
      tags: [T_WAR],
      note:
        'The army came home without its equipment. What stood between that and an invasion was ' +
        'the air force and the Channel, in that order.',
    },
    {
      key: 'nuremberg-from-vE',
      from: 've-day',
      to: 'nuremberg',
      tags: [T_POLITICS],
      note:
        'Six months from surrender to trial. The speed matters: it was decided while the ' +
        'evidence and the defendants were both still to hand.',
    },
  ],
};
