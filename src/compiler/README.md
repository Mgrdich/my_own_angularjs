# `@compiler` — (Reserved)

Placeholder barrel for the future DOM compiler (`$compile` / directives / interpolation). Currently exports nothing.

The subpath is wired into `package.json`'s `exports` map so that once implementation lands, consumers can `import { … } from 'my-own-angularjs/compiler'` without changes to the build.

See `context/product/roadmap.md` for the compiler slice plan.
