#!/usr/bin/env node
// Published consumers run ordinary JavaScript built during `prepack`; tsx is only a
// development tool and is not required to launch the installed package.
await import('../dist/arcade/main.js');
