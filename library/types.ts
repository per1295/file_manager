import type { KeyDownEvents } from "./enums";

export type KeyDownEventsKeys = keyof typeof KeyDownEvents;

export type AnyFunc<TArg = unknown | never, TReturn = void> = (...args: TArg[]) => TReturn | Promise<TReturn>;

export type TerminalWriteGen = Generator<string, void>;

export type Nullable<Type = unknown> = Type | null;

export type DeskMenuEnterHandlersType = 'BACK' | 'DELETE' | 'OPEN';