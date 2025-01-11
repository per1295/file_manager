import type { UpdateInterfaceType } from "./enums";
import type { TerminalWriteGen, DeskMenuEnterHandlersType } from "./types";
import type { WorkingDirWriter, DeskMenuWriter } from "./writers";
import type { KeyDownObserver } from "./keyboad";

export interface IChosenDirContent {
    path: string;
    displayPath: string;
}

export interface IActiveChosenContent {
    path: string;
    isDir: boolean;
}

export interface IUpdateInterfaceInf<ValueType = unknown> {
    type: UpdateInterfaceType;
    oldValue?: ValueType;
    value?: ValueType;
}

export interface IStartCoords {
    dx: number;
    dy: number;
}

export interface ITerminalSize {
    numColumns: number;
    numRows: number;
}

export interface ITerminalWriter {
    get crossRef(): ITerminalWriter;
    set crossRef(value: ITerminalWriter);
    writeGen(observer: KeyDownObserver): TerminalWriteGen;
}

export interface ITerminalHandlers {
    up(observer: KeyDownObserver): void;
    down(observer: KeyDownObserver): void;
    enter(observer: KeyDownObserver): void;
}

export interface IUpdateInterfaceConstruct {
    workingDirWriter: WorkingDirWriter;
    deskMenuWriter: DeskMenuWriter;
    observer: KeyDownObserver;
}

export interface IDeskMenuEnterHandler {
    name: DeskMenuEnterHandlersType;
    handle(observer: KeyDownObserver): Promise<void>;
}