/** Facade over all metric modules. Pages talk only to this. */
import type { Warehouse } from '../domain/types';
import { Channels } from './channels';
import { Core } from './core';
import { Finance } from './finance';
import { Funnel } from './funnel';
import { Health } from './health';
import { Marketing } from './marketing';
import { Ops } from './ops';
import { Plan } from './plan';
import { buildRecommendations } from './recommendations';
import type { DateRange } from './range';
import { Retention } from './retention';

export class Engine {
  readonly core: Core;
  readonly marketing: Marketing;
  readonly funnel: Funnel;
  readonly ops: Ops;
  readonly retention: Retention;
  readonly channels: Channels;
  readonly finance: Finance;
  readonly plan: Plan;
  readonly health: Health;

  constructor(w: Warehouse) {
    this.core = new Core(w);
    this.marketing = new Marketing(this.core);
    this.funnel = new Funnel(this.core);
    this.ops = new Ops(this.core);
    this.retention = new Retention(this.core);
    this.channels = new Channels(this.core);
    this.finance = new Finance(this.core);
    this.plan = new Plan(this.core);
    this.health = new Health(this.core);
  }

  get w() {
    return this.core.w;
  }

  get cal() {
    return this.core.cal;
  }

  recommendations(r: DateRange) {
    return buildRecommendations(this.core, this.marketing, this.ops, r);
  }
}
