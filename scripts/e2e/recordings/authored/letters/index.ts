/** Every authored application, by the company name the e2e jobs carry. */
import type { Application } from '../writer.ts';
import { atlas } from './atlas.ts';
import { brightwater } from './brightwater.ts';
import { copperline } from './copperline.ts';
import { harborPine } from './harbor-pine.ts';
import { kranich } from './kranich.ts';
import { lumenLedger } from './lumen-ledger.ts';
import { meridian } from './meridian.ts';
import { northwind } from './northwind.ts';
import { orchard } from './orchard.ts';
import { pebble } from './pebble.ts';
import { quillstack } from './quillstack.ts';
import { saffron } from './saffron.ts';
import { tulipTern } from './tulip-tern.ts';

const ALL: Application[] = [atlas, brightwater, copperline, harborPine, kranich, lumenLedger, meridian, northwind, orchard, pebble, quillstack, saffron, tulipTern];

export const APPLICATIONS: Record<string, Application> = Object.fromEntries(ALL.map((a) => [a.company, a]));
