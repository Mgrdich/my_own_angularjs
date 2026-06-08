export { directiveNormalize } from './directive-normalize';
export {
  DuplicateTranscludeSelectorError,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- ElementTranscludeNotSupportedError is intentionally re-exported (spec 027 Slice 2) for the one-release deprecation grace period. The throw site has been removed but the class stays exported so consumers catching via `instanceof` keep compiling.
  ElementTranscludeNotSupportedError,
  EmptyTemplateError,
  EmptyTemplateUrlError,
  InvalidComponentDefinitionError,
  InvalidDirectiveFactoryError,
  InvalidDirectiveNameError,
  InvalidIsolateBindingError,
  InvalidTemplateUrlValueError,
  InvalidTemplateValueError,
  InvalidTranscludeSelectorError,
  InvalidTranscludeSlotNameError,
  InvalidTranscludeValueError,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- IsolateScopeNotSupportedError is intentionally re-exported (spec 022 Slice 1) for the one-release deprecation grace period. The throw site has been removed but the class stays exported so consumers catching via `instanceof` keep compiling.
  IsolateScopeNotSupportedError,
  MissingRequiredControllerError,
  MultipleIsolateScopeError,
  MultipleTemplateDirectivesError,
  MultipleTranscludeDirectivesError,
  NgRepeatBadAliasError,
  NgRepeatBadIdentifierError,
  NgRepeatBadIteratorExpressionError,
  NgTranscludeMisuseError,
  ReplaceTrueNotSupportedError,
  RequiredTranscludeSlotUnfilledError,
  TemplateAndTemplateUrlCombinedError,
  TemplateFetchFailedError,
  TemplateFunctionReturnedNonStringError,
  TemplateUrlFunctionReturnedNonStringError,
  UndeclaredTranscludeSlotError,
} from './compile-error';
export { parseBindingSpec, parseIsolateBindings, wireIsolateBindings } from './isolate-bindings';
export type {
  BindingMode,
  IsolateBindingChangeCallback,
  NormalizedBindingMap,
  NormalizedBindingSpec,
} from './isolate-bindings';
export { ChangesQueue, flushChangesQueue, hasHook, invokeHook, SimpleChange, UNINITIALIZED_VALUE } from './lifecycle';
export type { ChangeRecord, LifecycleHookName } from './lifecycle';
export { $CompileProvider } from './compile-provider';
export { createCompile } from './compile';
export { AttributesImpl } from './attributes';
export { addElementCleanup, destroyElementScope, getElementScope, setElementScope } from './cleanup';
export type {
  Attributes,
  CompileFn,
  CompileOptions,
  CompileService,
  ComponentDefinition,
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
