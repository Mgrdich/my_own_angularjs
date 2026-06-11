export * from './core/index';

export { parse } from './parser/index';
export type { ExpressionFn, Token, ASTNode } from './parser/index';

export { Module, createModule, getModule, resetRegistry, createInjector } from './di/index';
export type {
  AnyModule,
  Annotated,
  Injector,
  Invokable,
  InvokableArray,
  InvokableReturn,
  MergeRegistries,
  ModuleAPI,
  ProviderArray,
  ProviderConstructor,
  ProviderInstance,
  ProviderObject,
  ProviderService,
  ProvideService,
  RecipeType,
  ResolveDeps,
  TypedModule,
} from './di/index';

export { createInterpolate, interpolate } from './interpolate/index';
export type { InterpolateFn, InterpolateOptions, InterpolateService } from './interpolate/index';

export {
  createSce,
  sce,
  createSceDelegate,
  sceDelegate,
  SCE_CONTEXTS,
  TrustedValue,
  TrustedHtml,
  TrustedUrl,
  TrustedResourceUrl,
  TrustedJs,
  TrustedCss,
  isTrustedValue,
  isTrustedFor,
  isValidSceContext,
} from './sce/index';
export type {
  SceContext,
  SceService,
  SceDelegateService,
  SceOptions,
  SceDelegateOptions,
  ResourceUrlListEntry,
  SceParsedFn,
} from './sce/index';

export { createSanitize, sanitize, ngSanitize } from './sanitize/index';
export type { SanitizeService, SanitizeOptions } from './sanitize/index';

export {
  invokeExceptionHandler,
  consoleErrorExceptionHandler,
  noopExceptionHandler,
  exceptionHandler,
  EXCEPTION_HANDLER_CAUSES,
} from './exception-handler/index';
export type { ExceptionHandler, ExceptionHandlerCause } from './exception-handler/index';

export {
  AttributesImpl,
  createCompile,
  directiveNormalize,
  DuplicateTranscludeSelectorError,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- ElementTranscludeNotSupportedError is intentionally re-exported (spec 027 Slice 2) for the one-release deprecation grace period. See @compiler/index.ts for context.
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
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- IsolateScopeNotSupportedError is intentionally re-exported (spec 022 Slice 1) for the one-release deprecation grace period. See @compiler/index.ts for context.
  IsolateScopeNotSupportedError,
  MissingRequiredControllerError,
  MultipleIsolateScopeError,
  MultipleTemplateDirectivesError,
  MultipleTranscludeDirectivesError,
  NgPluralizeBadOffsetError,
  NgPluralizeNoRuleDefinedError,
  NgRepeatBadAliasError,
  NgRepeatBadIdentifierError,
  NgRepeatBadIteratorExpressionError,
  NgRepeatDuplicateKeyError,
  NgTranscludeMisuseError,
  parseBindingSpec,
  parseIsolateBindings,
  ReplaceTrueNotSupportedError,
  RequiredTranscludeSlotUnfilledError,
  TemplateAndTemplateUrlCombinedError,
  TemplateFetchFailedError,
  TemplateFunctionReturnedNonStringError,
  TemplateUrlFunctionReturnedNonStringError,
  UndeclaredTranscludeSlotError,
  wireIsolateBindings,
} from './compiler/index';
export type {
  Attributes,
  BindingMode,
  CloneAttachFn,
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
  NormalizedBindingMap,
  NormalizedBindingSpec,
  TemplateFn,
  TemplateUrlFn,
  TranscludeFn,
  TranscludeSlot,
  TranscludeSlotMap,
  TranscludeSlotName,
} from './compiler/index';

export {
  $TemplateCacheProvider,
  $TemplateRequestProvider,
  createTemplateCache,
  createTemplateRequest,
  templateCache,
  templateRequest,
} from './template/index';
export type {
  CreateTemplateRequestArgs,
  TemplateCacheInfo,
  TemplateCacheService,
  TemplateFetcher,
  TemplateRequestFn,
} from './template/index';

export {
  ControllerAsWithoutControllerError,
  ControllerRegistrationOutOfPhaseError,
  createController,
  InvalidControllerFactoryError,
  InvalidControllerNameError,
  MalformedControllerAliasError,
  UnknownControllerError,
} from './controller/index';
export type {
  ControllerInvokable,
  ControllerLocals,
  ControllerService,
  DeferredControllerResult,
  IControllerProvider,
} from './controller/index';
