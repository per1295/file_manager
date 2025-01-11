import { stdout } from "process";
import { Readline } from "readline/promises";
import { getAppVariables, TypeChecker, addTerminalResizeHandle, rl } from "./functions";
import { TargetTerminalSpace, UpdateInterfaceType } from "./enums";

import type { ITerminalWriter, ITerminalSize, IActiveChosenContent, IUpdateInterfaceInf, IStartCoords, IUpdateInterfaceConstruct } from "./interfaces";
import type { Nullable, TerminalWriteGen } from "./types";
import type { FileManager } from "./fileManager";
import type { KeyDownObserver } from "./keyboad";

const {
    UNUSED_TERMINAL_COLUMNS,
    UNUSED_TERMINAL_ROWS,
    ROW_CHARACTER,
    ROW_PADDING,
    PROMPT,
    DESK_PART,
    COLUMN_CHARACTER,
    DESK_MENU_DIR,
    DESK_MENU_FILE,
    END_LINE,
    WRITE_MORE_BACKWARD,
    WRITE_MORE_FORWARD
} = getAppVariables();

let wasTerminalWriterConstruct = false;

abstract class TerminalWriter implements ITerminalWriter {
    private static _deskPartLength: Nullable<number> = null;
    private static _terminalSize: Nullable<ITerminalSize> = null;

    public static get deskPartLength() {
        return TerminalWriter._deskPartLength;
    }

    public static set deskPartLength(value: Nullable<number>) {
        if ( TypeChecker.isNull(value) ) {
            throw new TypeError('deskPart cannot be a null');
        }

        TerminalWriter._deskPartLength = value;
    }

    public static get terminalSize() {
        if ( TypeChecker.isNull(TerminalWriter._terminalSize) ) {
            let [ numColumns, numRows ] = stdout.getWindowSize();

            numColumns -= UNUSED_TERMINAL_COLUMNS;
            numRows -= UNUSED_TERMINAL_ROWS;

            TerminalWriter._terminalSize = { numColumns, numRows };
        }

        return TerminalWriter._terminalSize;
    }

    public needToWriteArrows = false;

    public abstract get crossRef(): TerminalWriter;

    public abstract set crossRef(value: TerminalWriteGen);

    constructor() {
        if ( !wasTerminalWriterConstruct ) {
            addTerminalResizeHandle(() => {
                TerminalWriter._terminalSize = null;
                TerminalWriter._deskPartLength = null;
            });

            wasTerminalWriterConstruct = true;
        }
    }

    public abstract writeGen(observer: KeyDownObserver): TerminalWriteGen;
}

export class WorkingDirWriter extends TerminalWriter {
    private _indexTargetContent = 0;
    private _crossRef: Nullable<DeskMenuWriter> = null;

    public fileManager: FileManager;

    private get workingDirEmptyLine() {
        if ( !WorkingDirWriter.deskPartLength ) {
            throw new TypeError('deskPartLength was not defined');
        }

        const { numColumns } = WorkingDirWriter.terminalSize;
        let workingDirLine = '';

        const workingDirLineLength = numColumns - WorkingDirWriter.deskPartLength - 3;
        workingDirLine += ROW_CHARACTER;
        workingDirLine += ' '.repeat(workingDirLineLength);

        return workingDirLine;
    }

    public get restLines() {
        const { numRows } = WorkingDirWriter.terminalSize;
        const restLines = numRows - this.fileManager.chosenDirContentsInterface.length * 2 - 2;

        return restLines;
    }

    public get isThereRestLines() {
        return this.restLines > 0
    }

    public get indexTargetContent() {
        return this._indexTargetContent;
    }

    public set indexTargetContent(value: number) {
        const chosenDirContentLength = this.fileManager.chosenDirContentsPath.length;

        if ( value < 0 ) {
            this._indexTargetContent = chosenDirContentLength - 1;
        } else if ( value > chosenDirContentLength - 1 ) {
            this._indexTargetContent = 0;
        } else {
            this._indexTargetContent = value;
        }
    }

    public override get crossRef() {
        if ( TypeChecker.isNull(this._crossRef) ) {
            throw new TypeError('In workingDirWriter _crossRef should be a deskMenuWriter');
        }

        return this._crossRef;
    }

    public override set crossRef(value: DeskMenuWriter) {
        this._crossRef = value;
    }

    constructor(manager: FileManager) {
        super();

        this.fileManager = manager;
    }

    public setIsNeedToWriteArrows() {
        if ( TypeChecker.isNull(this.fileManager.contentsEndIndex) ) {
            throw new TypeError('contentsEndIndex is not defined');
        }

        if ( this.fileManager.contentsEndIndex < this.fileManager.chosenDirAllPaths.length - 1 ) {
            this.needToWriteArrows = true;
            this.fileManager.contentsEndIndex -= 1;
        } else {
            this.needToWriteArrows = false;
        }
    }

    public normalizeWorkingDirLine(observer: KeyDownObserver, content: string, index?: number) {
        let workingDirLine = '';

        const { numColumns } = WorkingDirWriter.terminalSize;
        const isWorkingDirActive = observer.targetTerminalSpace === TargetTerminalSpace.WORKING_DIR;
        const isTarget = index === this.indexTargetContent && isWorkingDirActive;
        const horizontalBorder = `${ROW_CHARACTER}${ROW_PADDING}`;

        workingDirLine += horizontalBorder;
        workingDirLine += `${isTarget ? PROMPT : ''}${content}`;

        const allPaddingCount = numColumns - workingDirLine.length;

        if ( TypeChecker.isNull(WorkingDirWriter.deskPartLength) ) {
            WorkingDirWriter.deskPartLength = Math.ceil(allPaddingCount * DESK_PART);
        }

        const rightPaddingCount = allPaddingCount - WorkingDirWriter.deskPartLength - 2;
        const rightPadding = ' '.repeat(rightPaddingCount);

        workingDirLine += rightPadding;

        return workingDirLine;
    }

    public override *writeGen(observer: KeyDownObserver): TerminalWriteGen {
        let needToWriteWorkingDirEmptyLine = false;

        for ( let i = 0; i < this.fileManager.chosenDirContentsInterface.length * 2; i++ ) {
            let workingDirLine = '';

            if ( needToWriteWorkingDirEmptyLine ) {
                workingDirLine = this.workingDirEmptyLine;
                needToWriteWorkingDirEmptyLine = false;
            } else {
                const contentIndex = i / 2;
                const content = this.fileManager.chosenDirContentsInterface.at(contentIndex) as string;

                workingDirLine = this.normalizeWorkingDirLine(observer, content, contentIndex);
                needToWriteWorkingDirEmptyLine = true;
            }

            yield workingDirLine;
        }
        
        if ( this.isThereRestLines ) {
            for ( let i = 1; i <= this.restLines; i++ ) {
                const emptyLine = this.workingDirEmptyLine;

                yield emptyLine;
            }
        }
    }
}

export class DeskMenuWriter extends TerminalWriter {
    private _targetDeskMenuItemIndex = 0;
    private _crossRef: Nullable<WorkingDirWriter> = null;
    private _activeChosenDirContent: Nullable<IActiveChosenContent> = null;

    public get targetDeskMenuItemIndex() {
        return this._targetDeskMenuItemIndex;
    }

    public set targetDeskMenuItemIndex(value: number) {
        if ( !this._activeChosenDirContent ) {
            throw new TypeError('There is no chosen dir content');
        }

        const deskMenuItemsLength = this._activeChosenDirContent.isDir ? DESK_MENU_DIR.length : DESK_MENU_FILE.length;

        if ( value < 0 ) {
            this._targetDeskMenuItemIndex = deskMenuItemsLength - 1;
        } else if ( value > deskMenuItemsLength - 1 ) {
            this._targetDeskMenuItemIndex = 0;
        } else {
            this._targetDeskMenuItemIndex = value;
        }
    }

    public get activeChosenDirContent() {
        return this._activeChosenDirContent;
    }

    public set activeChosenDirContent(value: Nullable<IActiveChosenContent>) {
        this._activeChosenDirContent = value;
    }

    public override get crossRef() {
        if ( TypeChecker.isNull(this._crossRef) ) {
            throw new TypeError('In deskMenuWriter _crossRef should be a workingDirWriter');
        }

        return this._crossRef;
    }

    public override set crossRef(value: WorkingDirWriter) {
        this._crossRef = value;
    }

    private _centredDeskMenuItem(item: string, totalLength: number, isItemTarget = false) {
        if ( isItemTarget ) {
            totalLength -= 4;
        }

        const itemStartPosition = Math.ceil(totalLength / 2);
        const itemStartIndex = Math.ceil(item.length / 2);
        const leftPaddingCount = itemStartPosition - itemStartIndex;
        let rightPaddingCount = totalLength - item.length - leftPaddingCount;

        if ( isItemTarget ) {
            rightPaddingCount += 2;
        }

        const leftPadding = ' '.repeat(leftPaddingCount);
        const rightPadding = ' '.repeat(rightPaddingCount);
        
        return `${leftPadding}${isItemTarget ? PROMPT : ''}${item}${rightPadding}`;
    }

    private _borderedDeskMenuItem(item: string) {
        return `${ROW_CHARACTER}${item}${ROW_CHARACTER}`;
    }

    public override *writeGen(observer: KeyDownObserver): TerminalWriteGen {
        if ( TypeChecker.isNull(DeskMenuWriter.deskPartLength) ) {
            throw new TypeError('deskPartLength was not defined');
        }

        if ( this._activeChosenDirContent ) {
            const deskMenuItems = this._activeChosenDirContent.isDir ? DESK_MENU_DIR : DESK_MENU_FILE;
            const longestItemLength = Math.max( ...deskMenuItems.map(item => item.length) );

            let deskMenuItemIndex = 0;

            for ( const deskMenuItem of deskMenuItems ) {
                const horizontalBorder = COLUMN_CHARACTER.repeat(longestItemLength + 4);
                let horizontalBorderLine = this._centredDeskMenuItem(horizontalBorder, DeskMenuWriter.deskPartLength);
                horizontalBorderLine = this._borderedDeskMenuItem(horizontalBorderLine);

                yield `${horizontalBorderLine}${END_LINE}`;

                let innerLeftPaddingCount = (horizontalBorder.length - deskMenuItem.length - 2) / 2;

                if ( innerLeftPaddingCount % 2 !== 0 ) {
                    innerLeftPaddingCount = Math.ceil(innerLeftPaddingCount);
                }

                const innerRightPaddingCount = innerLeftPaddingCount;

                const innerLeftPadding = ' '.repeat(innerLeftPaddingCount);
                const innerRightPadding = ' '.repeat(innerRightPaddingCount);
                const isDeskMenuItemTarget = this.targetDeskMenuItemIndex === deskMenuItemIndex
                    && observer.targetTerminalSpace === TargetTerminalSpace.DESK_MENU;

                let deskItemLine = `${innerLeftPadding}${deskMenuItem}${innerRightPadding}`;

                deskItemLine = this._borderedDeskMenuItem(deskItemLine);
                deskItemLine = this._centredDeskMenuItem(deskItemLine, DeskMenuWriter.deskPartLength, isDeskMenuItemTarget);
                deskItemLine = this._borderedDeskMenuItem(deskItemLine);

                yield `${deskItemLine}${END_LINE}`;

                yield `${horizontalBorderLine}${END_LINE}`;

                deskMenuItemIndex++;
            }
        }

        while(true) {
            const leftPadding = ' '.repeat(DeskMenuWriter.deskPartLength);

            let deskMenuLine = leftPadding;
            deskMenuLine = this._borderedDeskMenuItem(deskMenuLine);

            yield `${deskMenuLine}${END_LINE}`;
        }
    }
}

export class UpdaterInterface {
    private _readline = new Readline(stdout);
    private _fileManager: FileManager;
    private _workingDirWriter: WorkingDirWriter;
    private _deskMenuWriter: DeskMenuWriter;
    private _observer: KeyDownObserver;

    constructor(instances: IUpdateInterfaceConstruct) {
        this._workingDirWriter = instances.workingDirWriter;
        this._fileManager = this._workingDirWriter.fileManager;
        this._deskMenuWriter = instances.deskMenuWriter;
        this._observer = instances.observer;
    }

    private _getStartDeskMenuCoords(): IStartCoords {
        const { needToWriteArrows, isThereRestLines, restLines } = this._workingDirWriter;
        const { chosenDirContentsPath } = this._fileManager;

        if ( TypeChecker.isNull(DeskMenuWriter.deskPartLength) ) {
            throw new TypeError('deskPartLength cannot be a null');
        }

        const { numColumns } = DeskMenuWriter.terminalSize;
        let dy = -(chosenDirContentsPath.length * 2) - 1;

        if ( needToWriteArrows ) {
            dy -= 1;
        }

        if ( isThereRestLines ) {
            dy -= restLines
        }

        const dx = numColumns - DeskMenuWriter.deskPartLength - 2;

        return ({ dx, dy });
    }

    private _getStartWorkingDirCoords(): IStartCoords {
        const { chosenDirContentsPath } = this._fileManager;
        const { needToWriteArrows, isThereRestLines, restLines } = this._workingDirWriter;

        let dy = -(chosenDirContentsPath.length * 2) - 1;

        if ( needToWriteArrows ) {
            dy -= 1;
        }

        if ( isThereRestLines ) {
            dy -= restLines
        }

        const dx = 0;
        
        return ({ dx, dy });
    }

    private async _workingDirTargetContent(value: number, oldValue: number) {
        const { dx, dy } = this._getStartWorkingDirCoords();
        const { chosenDirContentsPath } = this._fileManager;
        const { needToWriteArrows, isThereRestLines, restLines } = this._workingDirWriter;

        await this._readline
            .moveCursor(dx, dy)
            .commit();

        const contentsLength = chosenDirContentsPath.length;
        const isToStartFromDown = value === 0 && oldValue === contentsLength - 1;
        const isToDownFromStart = value === contentsLength - 1 && oldValue === 0;
        const isDown = value > oldValue;
        const dy_1 = oldValue * 2;
        const dy_2 = isToStartFromDown ? -(contentsLength - 1) * 2 :
            isToDownFromStart ? (contentsLength - 1) * 2 :
            isDown ? 2 : -2;
        let dy_3 = isToStartFromDown ? -dy :
            isToDownFromStart ? 3 :
            -dy - dy_2 - dy_1;

        if ( isToDownFromStart && needToWriteArrows ) {
            dy_3 += 1;
        }

        if ( isToDownFromStart && isThereRestLines ) {
            dy_3 += restLines;
        }

        const writeWorkingDirGen = this._workingDirWriter.writeGen(this._observer);
        const deskMenuGen = this._deskMenuWriter.writeGen(this._observer);

        const writeWorkingDirArr = Array.from(writeWorkingDirGen);
        const line = writeWorkingDirArr.at(value * 2) as string;
        const prevLine = writeWorkingDirArr.at(oldValue * 2) as string;

        const { value: deskMenuValue } = deskMenuGen.next();

        await this._readline
            .moveCursor(0, dy_1)
            .clearLine(1)
            .commit();

        rl.write(`${prevLine}${deskMenuValue}`);

        await this._readline
            .moveCursor(0, dy_2 - 1)
            .clearLine(1)
            .commit();

        rl.write(`${line}${deskMenuValue}`);

        await this._readline
            .moveCursor(0, dy_3 - 1)
            .commit();
    }

    private async _writingDeskMenu() {
        const { dx, dy } = this._getStartDeskMenuCoords();
        const { chosenDirContentsInterface } = this._fileManager;
        const { activeChosenDirContent } = this._deskMenuWriter;
        const { needToWriteArrows, isThereRestLines, restLines } = this._workingDirWriter;

        const writeDeskMenuGen = this._deskMenuWriter.writeGen(this._observer);

        let deskMenuItems: Nullable<typeof DESK_MENU_DIR | typeof DESK_MENU_FILE> = null;

        if ( !TypeChecker.isNull(activeChosenDirContent) ) {
            deskMenuItems = activeChosenDirContent.isDir ? DESK_MENU_DIR : DESK_MENU_FILE;
        }
        
        await this._readline
            .moveCursor(dx, dy)
            .commit();

        const length = deskMenuItems ? deskMenuItems.length * 3 : chosenDirContentsInterface.length * 2;

        for ( let i = 1; i <= length; i++ ) {
            await this._readline
                .clearLine(1)
                .commit();
            
            const { value: deskMenuValue } = writeDeskMenuGen.next();
            rl.write(deskMenuValue as string);

            await this._readline
                .moveCursor(dx, 0)
                .commit();
        }

        const dx_1 = -dx;
        let dy_1 = 0;

        if ( deskMenuItems ) {
            dy_1 += Math.abs(dy) - deskMenuItems.length * 3;
        }  else {
            dy_1 += 1;

            if ( needToWriteArrows ) {
                dy_1 += 1;
            }
    
            if ( isThereRestLines ) {
                dy_1 += restLines;
            }
        }

        await this._readline
            .moveCursor(dx_1, dy_1)
            .commit();
    }

    public async update(terminalSpace: TargetTerminalSpace, inf: IUpdateInterfaceInf) {
        const { type, value, oldValue } = inf;
        
        switch(type) {
            case UpdateInterfaceType.CHANGE_TARGET_CONTENT:
                {
                    if ( terminalSpace === TargetTerminalSpace.WORKING_DIR ) {
                        if ( !TypeChecker.isNumber(value) || !TypeChecker.isNumber(oldValue) ) {
                            throw new TypeError('WorkingDir update interface should get number values');
                        }

                        await this._workingDirTargetContent(value, oldValue);
                    } else {
                        await this._writingDeskMenu();
                    }
                }
                break;
            case UpdateInterfaceType.CHANGE_TARGET_SPACE:
                    {
                        await this._writingDeskMenu();
                    }
                break;
            case UpdateInterfaceType.OPEN_DIR:
            case UpdateInterfaceType.REMOVE_CONTENT:
                {
                    this.writeInterface();
                }
                break;
            default:
                throw new ReferenceError('Type is not from UpdateInterfaceType enum');
        }
    }

    public writeInterface() {
        rl.write(null, {
            ctrl: true,
            name: 'l'
        });

        const { needToWriteArrows } = this._workingDirWriter;
        const { numColumns } = DeskMenuWriter.terminalSize;
        
        let interfaceStr = '';

        const horizontalBorder = COLUMN_CHARACTER.repeat(numColumns);
        interfaceStr += `${horizontalBorder}${END_LINE}`;

        const workingDirGen = this._workingDirWriter.writeGen(this._observer);
        let deskMenuGen: Nullable<ReturnType<DeskMenuWriter['writeGen']>> = null;

        while(true) {
            let interfaceLine = '';

            const { done, value: workingDirLine } = workingDirGen.next();

            if ( done ) {
                break;
            }

            if ( TypeChecker.isNull(deskMenuGen) ) {
                deskMenuGen = this._deskMenuWriter.writeGen(this._observer);
            }

            const { value: deskMenuLine } = deskMenuGen.next();

            interfaceLine += `${workingDirLine}${deskMenuLine}`;
            interfaceStr += interfaceLine;
        }

        if ( needToWriteArrows ) {
            let writeArrowLine = '';

            const { value: deskMenuValue } = deskMenuGen!.next();

            writeArrowLine += this._workingDirWriter.normalizeWorkingDirLine(
                this._observer,
                `${WRITE_MORE_BACKWARD}${ROW_PADDING}${WRITE_MORE_FORWARD}`
            );
            writeArrowLine += deskMenuValue;
            interfaceStr += writeArrowLine;
        }

        interfaceStr += `${horizontalBorder}${END_LINE}`;

        rl.write(interfaceStr);
    }
}