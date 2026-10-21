#!/usr/bin/env node
import config from '../lib/product.mjs';
import { main } from '../lib/runtime.mjs';
await main(config);
