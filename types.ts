export interface IChosenDirContent {
    path: string;
    displayPath: string;
}

export interface IActiveChosenContent {
    path: string;
    isDir: boolean;
}

export type KeyDownEvents = 'change' | 'down' | 'up' | 'enter';

export type AnyFunc<TArgs = any, TReturn = void> = (...args: TArgs[]) => TReturn;

export type TargetTerminalSpace = 'workingDir' | 'deskMenu';