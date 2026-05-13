export { directiveNormalize } from './directive-normalize';
export {
  DuplicateTranscludeSelectorError,
  ElementTranscludeNotSupportedError,
  EmptyTemplateError,
  EmptyTemplateUrlError,
  InvalidDirectiveFactoryError,
  InvalidDirectiveNameError,
  InvalidTemplateUrlValueError,
  InvalidTemplateValueError,
  InvalidTranscludeSelectorError,
  InvalidTranscludeSlotNameError,
  InvalidTranscludeValueError,
  IsolateScopeNotSupportedError,
  MultipleTemplateDirectivesError,
  MultipleTranscludeDirectivesError,
  NgTranscludeMisuseError,
  ReplaceTrueNotSupportedError,
  RequiredTranscludeSlotUnfilledError,
  TemplateAndTemplateUrlCombinedError,
  TemplateFetchFailedError,
  TemplateFunctionReturnedNonStringError,
  TemplateUrlFunctionReturnedNonStringError,
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
  TemplateFn,
  TemplateUrlFn,
} from './directive-types';
export type {
  CloneAttachFn,
  TranscludeFn,
  TranscludeSlot,
  TranscludeSlotMap,
  TranscludeSlotName,
} from './transclude-types';
