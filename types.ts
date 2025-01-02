export interface IChosenDirContent {
    path: string;
    displayPath: string;
}

export interface IActiveChosenContent {
    path: string;
    isDir: boolean;
}
export enum KeyDownEvents {
    CHANGE,
    DOWN,
    UP,
    ENTER
}

export type AnyFunc<TArg = unknown | never, TReturn = void> = (...args: TArg[]) => TReturn | Promise<TReturn>;

export enum TargetTerminalSpace {
    WORKING_DIR,
    DESK_MENU
}

export interface IUpdateInterface<ValueType = unknown> {
    type: UpdateInterfaceType;
    oldValue?: ValueType;
    value?: ValueType;
}

export enum UpdateInterfaceType {
    CHANGE_TARGET_CONTENT,
    CHANGE_TARGET_SPACE,
    OPEN_DIR,
    REMOVE_CONTENT
}

export type DeskMenuGen = Generator<string, void, unknown> | null;

export interface IStartCoords {
    dx: number;
    dy: number;
}

export interface ITerminalSize {
    numColumns: number;
    numRows: number;
}