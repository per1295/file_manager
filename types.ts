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

export interface IUpdateInterface<ValueType = string | number> {
    type: UpdateInterfaceType;
    oldValue?: ValueType;
    value?: ValueType;
}

type UpdateInterfaceType = 'changeTargetContent' | 'changeTargetSpace';

export type DeskMenuGen = Generator<string, void, unknown> | null;

export interface IStartDeskMenuCoords {
    dx: number;
    dy: number;
}