export { directiveNormalize } from './directive-normalize';
export {
  DuplicateTranscludeSelectorError,
  ElementTranscludeNotSupportedError,
  InvalidDirectiveFactoryError,
  InvalidDirectiveNameError,
  InvalidTranscludeSelectorError,
  InvalidTranscludeSlotNameError,
  InvalidTranscludeValueError,
  IsolateScopeNotSupportedError,
  MultipleTranscludeDirectivesError,
  NgTranscludeMisuseError,
  RequiredTranscludeSlotUnfilledError,
  UndeclaredTranscludeSlotError,
} from './compile-error';
export { $CompileProvider } from './compile-provider';
export { createCompile } from './compile';
export { AttributesImpl } from './attributes';
export { addElementCleanup, destroyElementScope, getElementScope, setElementScope } from './cleanup';
export type {
  Attributes,
  CompileFn,
  CompileOptions,
  CompileService,
  Directive,
  DirectiveDefinition,
  DirectiveFactory,
  DirectiveFactoryReturn,
  Linker,
  LinkFn,
} from './directive-types';
export type {
  CloneAttachFn,
  TranscludeFn,
  TranscludeSlot,
  TranscludeSlotMap,
  TranscludeSlotName,
} from './transclude-types';
