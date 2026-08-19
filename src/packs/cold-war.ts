/**
 * The Cold War, as an installable pack (docs/design.md §5).
 *
 * Same shape as the war pack: a skeleton of about forty events, 1946–1991, with
 * the crises, the space race and the arms control kept legible as separate
 * strands rather than merged into one list of dates.
 */

import { fromGregorian, instant, interval } from '../core/time';
import type { PackBundle } from '../core/packs';
import {
  R_AFRICA,
  R_AMERICAS,
  R_ASIA,
  R_BRITAIN,
  R_CHINA,
  R_EUROPE,
  R_GERMANY,
  R_NEAR_EAST,
  R_RUSSIA,
  T_ECONOMICS,
  T_POLITICS,
  T_SCIENCE,
  T_TECHNOLOGY,
  T_WAR,
} from '../core/model/builtin-tags';

const day = (year: number, month: number, date: number) => instant(year, month, date);
const span = (from: [number, number, number], to: [number, number, number]) =>
  interval(fromGregorian(...from), fromGregorian(...to));

export const COLD_WAR: PackBundle = {
  id: 'pack.cold-war',
  name: 'The Cold War',
  version: '1.0.0',
  license: 'CC0-1.0',
  description:
    'Forty-odd events, 1946–1991: the division of Europe, the crises, the space race, and the ' +
    'arms control that grew out of them.',

  events: [
    {
      key: 'iron-curtain',
      title: 'Churchill’s "iron curtain" speech at Fulton',
      when: day(1946, 3, 5),
      tags: [T_POLITICS, R_BRITAIN, R_AMERICAS],
    },
    {
      key: 'truman-doctrine',
      title: 'the Truman Doctrine',
      when: day(1947, 3, 12),
      tags: [T_POLITICS, R_AMERICAS],
    },
    {
      key: 'marshall-plan',
      title: 'the Marshall Plan is announced',
      when: day(1947, 6, 5),
      tags: [T_POLITICS, T_ECONOMICS, R_AMERICAS, R_EUROPE],
    },
    {
      key: 'partition-of-india',
      title: 'the partition of India',
      when: day(1947, 8, 15),
      tags: [T_POLITICS, R_ASIA],
    },
    {
      key: 'berlin-blockade',
      title: 'the Berlin blockade and airlift',
      when: span([1948, 6, 24], [1949, 5, 13]),
      tags: [T_POLITICS, R_GERMANY, R_RUSSIA, R_AMERICAS],
    },
    {
      key: 'nato',
      title: 'NATO is founded',
      when: day(1949, 4, 4),
      tags: [T_POLITICS, R_AMERICAS, R_EUROPE],
    },
    {
      key: 'soviet-bomb',
      title: 'the Soviet Union tests its first atomic bomb',
      when: day(1949, 8, 29),
      tags: [T_TECHNOLOGY, T_WAR, R_RUSSIA],
    },
    {
      key: 'prc-founded',
      title: 'the People’s Republic of China is proclaimed',
      when: day(1949, 10, 1),
      tags: [T_POLITICS, R_CHINA],
    },
    {
      key: 'korean-war',
      title: 'the Korean War',
      when: span([1950, 6, 25], [1953, 7, 28]),
      tags: [T_WAR, R_ASIA, R_AMERICAS, R_CHINA],
    },
    {
      key: 'stalin-dies',
      title: 'Stalin dies',
      when: day(1953, 3, 5),
      tags: [T_POLITICS, R_RUSSIA],
    },
    {
      key: 'warsaw-pact',
      title: 'the Warsaw Pact is signed',
      when: day(1955, 5, 14),
      tags: [T_POLITICS, R_RUSSIA, R_EUROPE],
    },
    {
      key: 'secret-speech',
      title: 'Khrushchev’s secret speech denouncing Stalin',
      when: day(1956, 2, 25),
      tags: [T_POLITICS, R_RUSSIA],
    },
    {
      key: 'suez',
      title: 'the Suez crisis',
      when: span([1956, 10, 29], [1956, 11, 7]),
      tags: [T_POLITICS, T_WAR, R_NEAR_EAST, R_BRITAIN],
    },
    {
      key: 'hungary-1956',
      title: 'the Hungarian revolution is crushed',
      when: span([1956, 10, 23], [1956, 11, 11]),
      tags: [T_POLITICS, R_EUROPE, R_RUSSIA],
    },
    {
      key: 'sputnik',
      title: 'Sputnik 1',
      when: day(1957, 10, 4),
      tags: [T_TECHNOLOGY, T_SCIENCE, R_RUSSIA],
    },
    {
      key: 'gagarin',
      title: 'Gagarin becomes the first person in orbit',
      when: day(1961, 4, 12),
      tags: [T_TECHNOLOGY, T_SCIENCE, R_RUSSIA],
    },
    {
      key: 'bay-of-pigs',
      title: 'the Bay of Pigs invasion',
      when: span([1961, 4, 17], [1961, 4, 20]),
      tags: [T_POLITICS, T_WAR, R_AMERICAS],
    },
    {
      key: 'berlin-wall-built',
      title: 'the Berlin Wall goes up',
      when: day(1961, 8, 13),
      tags: [T_POLITICS, R_GERMANY],
    },
    {
      key: 'cuban-missile-crisis',
      title: 'the Cuban missile crisis',
      when: span([1962, 10, 16], [1962, 10, 29]),
      tags: [T_POLITICS, T_WAR, R_AMERICAS, R_RUSSIA],
      notes: 'Thirteen days, and the closest the period came to ending itself.',
    },
    {
      key: 'test-ban-treaty',
      title: 'the Partial Test Ban Treaty',
      when: day(1963, 8, 5),
      tags: [T_POLITICS, R_AMERICAS, R_RUSSIA, R_BRITAIN],
    },
    {
      key: 'kennedy-assassinated',
      title: 'Kennedy is assassinated',
      when: day(1963, 11, 22),
      tags: [T_POLITICS, R_AMERICAS],
    },
    {
      key: 'gulf-of-tonkin',
      title: 'the Gulf of Tonkin resolution',
      when: day(1964, 8, 7),
      tags: [T_POLITICS, T_WAR, R_AMERICAS, R_ASIA],
    },
    {
      key: 'cultural-revolution',
      title: 'the Cultural Revolution',
      when: span([1966, 5, 16], [1976, 10, 6]),
      tags: [T_POLITICS, R_CHINA],
    },
    {
      key: 'prague-spring',
      title: 'the Prague Spring is crushed',
      when: day(1968, 8, 21),
      tags: [T_POLITICS, R_EUROPE, R_RUSSIA],
    },
    {
      key: 'npt',
      title: 'the Non-Proliferation Treaty opens for signature',
      when: day(1968, 7, 1),
      tags: [T_POLITICS, T_TECHNOLOGY],
    },
    {
      key: 'apollo-11',
      title: 'Apollo 11 lands on the Moon',
      when: day(1969, 7, 20),
      tags: [T_TECHNOLOGY, T_SCIENCE, R_AMERICAS],
    },
    {
      key: 'sino-soviet-split',
      title: 'the Sino-Soviet border conflict',
      when: span([1969, 3, 2], [1969, 9, 12]),
      tags: [T_POLITICS, T_WAR, R_CHINA, R_RUSSIA],
    },
    {
      key: 'nixon-in-china',
      title: 'Nixon visits China',
      when: span([1972, 2, 21], [1972, 2, 29]),
      tags: [T_POLITICS, R_CHINA, R_AMERICAS],
    },
    {
      key: 'salt-i',
      title: 'SALT I and the ABM Treaty are signed',
      when: day(1972, 5, 26),
      tags: [T_POLITICS, R_AMERICAS, R_RUSSIA],
    },
    {
      key: 'oil-crisis',
      title: 'the oil crisis',
      when: span([1973, 10, 17], [1974, 3, 18]),
      tags: [T_ECONOMICS, R_NEAR_EAST],
    },
    {
      key: 'fall-of-saigon',
      title: 'the fall of Saigon',
      when: day(1975, 4, 30),
      tags: [T_WAR, T_POLITICS, R_ASIA, R_AMERICAS],
    },
    {
      key: 'helsinki-accords',
      title: 'the Helsinki Accords',
      when: day(1975, 8, 1),
      tags: [T_POLITICS, R_EUROPE],
      notes:
        'The West conceded the post-war borders; the East conceded a human rights clause. Which ' +
        'side got the better of it took fifteen years to become clear.',
    },
    {
      key: 'soviet-afghanistan',
      title: 'the Soviet Union invades Afghanistan',
      when: day(1979, 12, 24),
      tags: [T_WAR, R_RUSSIA, R_ASIA],
    },
    {
      key: 'solidarity',
      title: 'Solidarity is founded at the Gdańsk shipyard',
      when: day(1980, 8, 31),
      tags: [T_POLITICS, T_ECONOMICS, R_EUROPE],
    },
    {
      key: 'able-archer',
      title: 'Able Archer 83',
      when: span([1983, 11, 7], [1983, 11, 12]),
      tags: [T_WAR, R_EUROPE],
      notes: 'A NATO exercise the Soviet leadership came close to reading as the real thing.',
    },
    {
      key: 'petrov',
      title: 'Stanislav Petrov declines to report a missile launch',
      when: day(1983, 9, 26),
      tags: [T_WAR, T_TECHNOLOGY, R_RUSSIA],
      notes: 'The satellite system was wrong. He judged that it was, and told no one for a decade.',
    },
    {
      key: 'gorbachev',
      title: 'Gorbachev becomes General Secretary',
      when: day(1985, 3, 11),
      tags: [T_POLITICS, R_RUSSIA],
    },
    {
      key: 'chernobyl',
      title: 'the Chernobyl disaster',
      when: day(1986, 4, 26),
      tags: [T_TECHNOLOGY, R_RUSSIA, R_EUROPE],
    },
    {
      key: 'inf-treaty',
      title: 'the INF Treaty is signed',
      when: day(1987, 12, 8),
      tags: [T_POLITICS, R_AMERICAS, R_RUSSIA],
      notes: 'The first treaty to remove an entire class of weapons rather than cap it.',
    },
    {
      key: 'tiananmen',
      title: 'the Tiananmen Square protests are suppressed',
      when: day(1989, 6, 4),
      tags: [T_POLITICS, R_CHINA],
    },
    {
      key: 'berlin-wall-falls',
      title: 'the Berlin Wall is opened',
      when: day(1989, 11, 9),
      tags: [T_POLITICS, R_GERMANY],
    },
    {
      key: 'german-reunification',
      title: 'German reunification',
      when: day(1990, 10, 3),
      tags: [T_POLITICS, R_GERMANY],
    },
    {
      key: 'mandela-released',
      title: 'Nelson Mandela is released',
      when: day(1990, 2, 11),
      tags: [T_POLITICS, R_AFRICA],
    },
    {
      key: 'august-coup',
      title: 'the August coup fails in Moscow',
      when: span([1991, 8, 19], [1991, 8, 22]),
      tags: [T_POLITICS, R_RUSSIA],
    },
    {
      key: 'ussr-dissolved',
      title: 'the Soviet Union is dissolved',
      when: day(1991, 12, 26),
      tags: [T_POLITICS, R_RUSSIA],
    },
  ],

  eras: [
    {
      key: 'the-cold-war',
      name: 'the Cold War',
      when: span([1947, 3, 12], [1991, 12, 27]),
      kind: 'canonical',
      tags: [T_POLITICS],
    },
    {
      key: 'detente',
      name: 'détente',
      when: span([1969, 1, 1], [1979, 12, 25]),
      kind: 'canonical',
      tags: [T_POLITICS],
    },
    {
      key: 'space-race',
      name: 'the space race',
      when: span([1957, 10, 4], [1975, 7, 24]),
      kind: 'canonical',
      tags: [T_TECHNOLOGY],
    },
    {
      key: 'vietnam-war',
      name: 'the Vietnam War',
      when: span([1955, 11, 1], [1975, 4, 30]),
      kind: 'canonical',
      tags: [T_WAR, R_ASIA],
    },
  ],

  connections: [
    {
      key: 'sputnik-to-apollo',
      from: 'sputnik',
      to: 'apollo-11',
      tags: [T_TECHNOLOGY],
      note:
        'Twelve years from a beeping sphere to a landing. The Moon programme is unintelligible ' +
        'except as an answer to this.',
    },
    {
      key: 'cuba-to-test-ban',
      from: 'cuban-missile-crisis',
      to: 'test-ban-treaty',
      tags: [T_POLITICS],
      note:
        'Ten months. Arms control in this period is almost always the aftermath of a fright ' +
        'rather than the product of a plan.',
    },
    {
      key: 'petrov-to-able-archer',
      from: 'petrov',
      to: 'able-archer',
      tags: [T_WAR],
      note:
        'Six weeks apart, in the same autumn, neither known to the public at the time. 1983 was ' +
        'closer to the edge than 1962 in everything but reputation.',
    },
    {
      key: 'wall-up-to-wall-down',
      from: 'berlin-wall-built',
      to: 'berlin-wall-falls',
      tags: [R_GERMANY],
      note: 'Twenty-eight years and three months.',
    },
    {
      key: 'helsinki-to-solidarity',
      from: 'helsinki-accords',
      to: 'solidarity',
      tags: [T_POLITICS],
      note:
        'The human rights clause the Soviet side treated as a formality became the legal hook ' +
        'for every dissident movement that followed, this one included.',
    },
    {
      key: 'gorbachev-to-wall',
      from: 'gorbachev',
      to: 'berlin-wall-falls',
      tags: [T_POLITICS],
      note:
        'What actually fell in 1989 was the guarantee that Moscow would send tanks. Once that ' +
        'was withdrawn, 1956 and 1968 did not repeat.',
    },
    {
      key: 'afghanistan-to-dissolution',
      from: 'soviet-afghanistan',
      to: 'ussr-dissolved',
      tags: [T_POLITICS],
      note: 'Twelve years, of which nine were the war.',
    },
    {
      key: 'split-to-nixon',
      from: 'sino-soviet-split',
      to: 'nixon-in-china',
      tags: [T_POLITICS],
      note:
        'The opening to China was possible only because the two communist powers had been ' +
        'shooting at each other on the Ussuri three years earlier.',
    },
    {
      key: 'chernobyl-to-coup',
      from: 'chernobyl',
      to: 'august-coup',
      tags: [T_POLITICS],
      note:
        'Gorbachev later dated glasnost from Chernobyl — the disaster made the habit of denial ' +
        'untenable, and the openness that followed is what let 1991 happen at all.',
    },
    {
      key: 'korea-to-vietnam',
      from: 'korean-war',
      to: 'fall-of-saigon',
      tags: [R_ASIA],
      note:
        'Two wars fought on the same theory of containment, twenty years apart, with opposite ' +
        'results. The second is what retired the theory.',
    },
    {
      key: 'marshall-to-nato',
      from: 'marshall-plan',
      to: 'nato',
      tags: [T_ECONOMICS],
      note: 'Money first, then the alliance to protect what it had rebuilt.',
    },
  ],
};
