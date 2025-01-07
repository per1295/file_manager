import { stdin, stdout } from "process";
import { createInterface, Readline } from "readline/promises";
import { join, resolve, normalize, parse as pathParse } from "path";
import { readdir, stat, rm } from "fs/promises";
import { EventEmitter } from "events";
import { isNull } from "./functions";

import type {
    Key,
    Interface
} from "readline";

import type {
    IChosenDirContent,
    IActiveChosenContent,
    AnyFunc,
    IUpdateInterface,
    DeskMenuGen,
    IStartCoords,
    ITerminalSize,
    KeyDownEventsKeys
} from "./types";

import { TargetTerminalSpace, KeyDownEvents, UpdateInterfaceType } from "./types";

class FileManager {
    protected DESK_PART = 1 / 3;
    private UPPER_DIR: IChosenDirContent = {
        path: '../',
        displayPath: '../'
    };

    protected _chosenDir: string;
    protected _chosenDirAllPaths: string[] = [ this.UPPER_DIR.path ];
    protected _chosenDirContents: IChosenDirContent[] = [ this.UPPER_DIR ];
    protected _indexTargetContent = 0;
    protected _contentsStartIndex = 0;
    protected _contentsEndIndex: number | null = null;
    protected _contentsRange: number | null = null;

    protected get indexTargetContent() {
        return this._indexTargetContent;
    }

    protected set indexTargetContent(value: number) {
        const chosenDirContentLength = this._chosenDirContents.length;

        if ( value < 0 ) {
            this._indexTargetContent = chosenDirContentLength - 1;
        } else if ( value > chosenDirContentLength - 1 ) {
            this._indexTargetContent = 0;
        } else {
            this._indexTargetContent = value;
        }
    }

    protected get chosenDirContentsPath() {
        return this._chosenDirContents.map(content => content.path);
    }

    protected get chosenDirContentsInterface() {
        return this._chosenDirContents.map(content => content.displayPath);
    }

    protected get contentsStartIndex() {
        return this._contentsStartIndex;
    }

    protected set contentsStartIndex(value: number) {
        if ( value < 0 ) {
            this._contentsStartIndex = 0;
        } else if ( value < this._chosenDirAllPaths.length - 2 ) {
            this._contentsStartIndex = value;
        }
    }

    protected get contentsEndIndex() {
        return this._contentsEndIndex;
    }

    protected set contentsEndIndex(value: number | null) {
        if ( isNull(value) ) {
            throw new TypeError('contentsEndIndex cannot be a null');
        }

        if ( this._contentsRange && value < this._contentsRange ) {
            this._contentsEndIndex = this._contentsRange;
        } else if ( this._chosenDirAllPaths.length > 1 && value > this._chosenDirAllPaths.length - 1 ) {
            this._contentsEndIndex = this._chosenDirAllPaths.length - 1;
        } else {
            this._contentsEndIndex = value;
        }
    }

    constructor(startDir = '') {
        this._chosenDir = resolve(startDir);
    }

    private async _getChosenDirContent(dirContent: string): Promise<IChosenDirContent> {
        const pathToDirContent = join(this._chosenDir, dirContent);

        try {
            const statsDirContent = await stat(pathToDirContent);

            if ( statsDirContent.isDirectory() ) {
                dirContent = `${dirContent}/`;
            }

            const { birthtimeMs, size } = statsDirContent;

            const normalizedTime = (new Date(birthtimeMs)).toLocaleString('ru').split(', ').join(' ');
            const normalizedSize = size !== 0 ? `${size}byte` : 'dir';

            const [ numColumns ] = stdout.getWindowSize();
            const maxContentLength = numColumns - Math.floor(numColumns * this.DESK_PART) - 6;

            let displayContent = `${normalizedTime} ${normalizedSize} ${dirContent}`;

            if ( displayContent.length > maxContentLength ) {
                displayContent = displayContent.slice(0, maxContentLength - 3).concat('...');
            }

            return ({
                path: dirContent,
                displayPath: displayContent
            });
        } catch {
            const displayContent = `? ? ${dirContent}`;

            return({
                path: dirContent,
                displayPath: displayContent
            });
        }
    }

    private _getResolvedPath(contentPath: string) {
        return normalize( join(this._chosenDir, contentPath) );
    }

    protected async _readChosenDir() {
        this._chosenDirAllPaths = await readdir(this._chosenDir);

        if ( !this.contentsEndIndex ) {
            throw new TypeError('contentsEndIndex is not defined');
        }

        const chosenDirPaths = this._chosenDirAllPaths
            .slice(this.contentsStartIndex, this.contentsEndIndex + 1)
            .filter(content => !!content);

        // Reset chosen dir contents
        this._chosenDirContents = new Array(chosenDirPaths.length + 1);
        this._chosenDirContents[0] = this.UPPER_DIR;
        
        for ( let i = 0; i < Math.ceil(chosenDirPaths.length / 2); i++ ) {
            const dirContent = chosenDirPaths.at(i) as string;
            const dirLastContent = chosenDirPaths.at(-1 - i) as string;

            const dirContentSetIndex = i + 1;
            const dirLastContentSetIndex = this._chosenDirContents.length - 1 - i;
            const isDirContentCenter = i === dirLastContentSetIndex;

            const chosenDirContent = await this._getChosenDirContent(dirContent);
            this._chosenDirContents[dirContentSetIndex] = chosenDirContent;

            if ( !isDirContentCenter ) {
                const chosenDirLastContent = await this._getChosenDirContent(dirLastContent);
                this._chosenDirContents[dirLastContentSetIndex] = chosenDirLastContent;
            }
        }
    }

    protected async _openDir(contentPath: string) {
        this._chosenDir = this._getResolvedPath(contentPath);
        this.indexTargetContent = 0;

        await this._readChosenDir();
    }

    protected async _rm(contentPath: string) {
        const { base } = pathParse(contentPath);
        const regExp = new RegExp(base, 'i');
        this._chosenDirContents = this._chosenDirContents.filter(content => {
            return !regExp.test(content.path);
        });

        contentPath = this._getResolvedPath(contentPath);

        await rm(contentPath, { recursive: true });
    }
}

export default class FileManagerInterface extends FileManager {
    private readonly UNUSED_TERMINAL_ROWS = 7;
    private readonly UNUSED_TERMINAL_COLUMNS = 1;

    protected readonly PROMPT = '> ';
    protected readonly ROW_CHARACTER = '|';
    protected readonly COLUMN_CHARACTER = '-'
    protected readonly ROW_PADDING = ' '.repeat(2);
    protected readonly WRITE_MORE_FORWARD = '"f" to -->';
    protected readonly WRITE_MORE_BACKWARD = '"b" to <--';
    
    // Writing desk menu constants
    protected readonly DESK_MENU_FILE = ['RENAME', 'DELETE', 'BACK'];
    protected readonly DESK_MENU_DIR = [...this.DESK_MENU_FILE, 'OPEN'];
    protected readonly END_LINE = '\n';

    private _targetDeskMenuItemIndex = 0;
    private _resizeTimeout: NodeJS.Timeout | null = null;
    private _terminalSize: ITerminalSize | null = null;

    protected _rl = createInterface({
        input: stdin,
        output: stdout,
        terminal: true,
        historySize: 0,
        prompt: ''
    });
    protected _keydownObserver = new KeyDownObserver(this._rl);
    protected _deskPartLength: number | null = null;
    protected _activeChosenDirContent: IActiveChosenContent | null = null;
    protected _readline = new Readline(stdout);
    protected _updateInterfaceHandlers = new UpdateInterfaceHandlers();
    protected _needToWriteArrows = false;

    private get targetDeskMenuItemIndex() {
        return this._targetDeskMenuItemIndex;
    }

    private set targetDeskMenuItemIndex(value: number) {
        if ( !this._activeChosenDirContent ) {
            throw new TypeError('There is no chosen dir content');
        }

        const deskMenuItemsLength = this._activeChosenDirContent.isDir ? this.DESK_MENU_DIR.length : this.DESK_MENU_FILE.length;

        if ( value < 0 ) {
            this._targetDeskMenuItemIndex = deskMenuItemsLength - 1;
        } else if ( value > deskMenuItemsLength - 1 ) {
            this._targetDeskMenuItemIndex = 0;
        } else {
            this._targetDeskMenuItemIndex = value;
        }
    }

    protected get terminalSize() {
        if ( !this._terminalSize ) {
            let [ numColumns, numRows ] = stdout.getWindowSize();

            numColumns -= this.UNUSED_TERMINAL_COLUMNS;
            numRows -= this.UNUSED_TERMINAL_ROWS;

            this._terminalSize = { numColumns, numRows };
        }

        return this._terminalSize;
    }

    protected get workingDirEmptyLine() {
        if ( !this._deskPartLength ) {
            throw new TypeError('deskPartLength was not defined');
        }

        const { numColumns } = this.terminalSize;
        let workingDirLine = '';

        const workingDirLineLength = numColumns - this._deskPartLength - 3;
        workingDirLine += this.ROW_CHARACTER;
        workingDirLine += ' '.repeat(workingDirLineLength);

        return workingDirLine;
    }

    protected get restLines() {
        const { numRows } = this.terminalSize;
        const restLines = numRows - this.chosenDirContentsInterface.length * 2 - 2;

        return restLines;
    }

    protected get isThereRestLines() {
        return (
            this.restLines > 0
        )
    }

    constructor(startDir = '') {
        super(startDir);

        // Set a handler of resize terminal size
        process.on('SIGWINCH', () => {
            if ( this._resizeTimeout ) {
                clearTimeout(this._resizeTimeout);
                this._resizeTimeout = null;
            }

            this._resizeTimeout = setTimeout(this._handleResizeTerminal.bind(this), 100);
        });
        
        // Set a keydown handlers
        this._keydownObserver.onDown(this._handleDownDir.bind(this), this._handleDownDesk.bind(this));
        this._keydownObserver.onUp(this._handleUpDir.bind(this), this._handleUpDesk.bind(this));
        this._keydownObserver.onEnter(this._handleEnterDir.bind(this), this._handleEnterDesk.bind(this));
        this._keydownObserver.onBackward(this._handleBackward.bind(this));
        this._keydownObserver.onForward(this._handleForward.bind(this));

        // Initializing a app
        this._initilize();
    }

    private _setIsNeedToWriteArrows() {
        if ( !this.contentsEndIndex ) {
            throw new TypeError('contentsEndIndex is not defined');
        }

        if ( this.contentsEndIndex < this._chosenDirAllPaths.length - 1 ) {
            this._needToWriteArrows = true;
            this.contentsEndIndex -= 1;
        } else {
            this._needToWriteArrows = false;
        }
    }

    private async _initilize() {
        this.contentsEndIndex = Math.floor(this.terminalSize.numRows / 2) - 2;
        this._contentsRange = this.contentsEndIndex;

        await this._readChosenDir();
        this._setIsNeedToWriteArrows();
        await this._writeInterface();
    }

    private async _writeInterface() {
        this._rl.write(null, {
            ctrl: true,
            name: 'l'
        });

        let interfaceStr = '';

        const { numColumns } = this.terminalSize;
        const horizontalBorder = this.COLUMN_CHARACTER.repeat(numColumns);
        interfaceStr += `${horizontalBorder}${this.END_LINE}`;

        const workingDirGen = this._writeWorkingDir();
        let deskMenuGen: DeskMenuGen = null;

        while(true) {
            let interfaceLine = '';

            const { done, value: workingDirLine } = workingDirGen.next();

            if ( done ) {
                break;
            }

            if ( !deskMenuGen ) {
                deskMenuGen = this._writeDeskMenu();
            }

            const { value: deskMenuLine } = deskMenuGen.next();

            interfaceLine += `${workingDirLine}${deskMenuLine}`;
            interfaceStr += interfaceLine;
        }

        if ( this._needToWriteArrows ) {
            let writeArrowLine = '';

            const { value: deskMenuValue } = deskMenuGen!.next();

            writeArrowLine += this._normalizeWorkingDirLine(`${this.WRITE_MORE_BACKWARD}${this.ROW_PADDING}${this.WRITE_MORE_FORWARD}`);
            writeArrowLine += deskMenuValue;
            interfaceStr += writeArrowLine;
        }

        interfaceStr += `${horizontalBorder}${this.END_LINE}`;

        this._rl.write(interfaceStr);
    }

    private async _handleResizeTerminal() {
        // Reset all sizes and indexes of terminal
        this._terminalSize = null;
        this._deskPartLength = null;
        this.contentsEndIndex = Math.floor(this.terminalSize.numRows / 2) - 2;
        this._contentsRange = this.contentsEndIndex;

        await this._readline
            .cursorTo(0, 0)
            .commit();

        await this._writeInterface();
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
        
        return `${leftPadding}${isItemTarget ? this.PROMPT : ''}${item}${rightPadding}`;
    }

    private _borderedDeskMenuItem(item: string) {
        return `${this.ROW_CHARACTER}${item}${this.ROW_CHARACTER}`;
    }

    private async _updateInterface(inf: IUpdateInterface) {
        const { type, value, oldValue } = inf;

        switch(type) {
            case UpdateInterfaceType.CHANGE_TARGET_CONTENT:
                {
                    let handler: AnyFunc<never>;
    
                    if ( this._keydownObserver.targetTerminalSpace === TargetTerminalSpace.WORKING_DIR ) {
                        if ( typeof value !== 'number' || typeof oldValue !== 'number' ) {
                            throw new TypeError('Inf`s value should be the numbers');
                        }

                        handler = this._updateInterfaceHandlers.workingDirTargetContent.bind(this, value, oldValue);
                    } else {
                        handler = this._updateInterfaceHandlers.writingDeskMenu.bind(this);
                    }

                    await handler();
                }
                break;
            case UpdateInterfaceType.CHANGE_TARGET_SPACE:
                {
                    await this._updateInterfaceHandlers.writingDeskMenu.call(this);
                }
                break;
            case UpdateInterfaceType.OPEN_DIR:
            case UpdateInterfaceType.REMOVE_CONTENT:
                {
                    await this._writeInterface();
                }
                break;
            default:
                throw new ReferenceError('Type is not from UpdateInterfaceType enum');
        }
    }

    private _handleUpDir = this._keydownObserver.calldownWrapper(
        async () => {
            const oldValue = this.indexTargetContent;
            this.indexTargetContent--;

            await this._updateInterface({
                type: UpdateInterfaceType.CHANGE_TARGET_CONTENT,
                value: this.indexTargetContent,
                oldValue
            });
        }
    );

    private _handleDownDir = this._keydownObserver.calldownWrapper(
        async () => {
            const oldValue = this.indexTargetContent;
            this.indexTargetContent++;

            await this._updateInterface({
                type: UpdateInterfaceType.CHANGE_TARGET_CONTENT,
                value: this.indexTargetContent,
                oldValue
            });
        }
    );

    private _handleUpDesk = this._keydownObserver.calldownWrapper(
        async () => {
            const oldValue = this.targetDeskMenuItemIndex;
            this.targetDeskMenuItemIndex--;

            await this._updateInterface({
                type: UpdateInterfaceType.CHANGE_TARGET_CONTENT,
                value: this.targetDeskMenuItemIndex,
                oldValue
            });
        }
    );

    private _handleDownDesk = this._keydownObserver.calldownWrapper(
        async () => {
            const oldValue = this.targetDeskMenuItemIndex;
            this.targetDeskMenuItemIndex++;

            await this._updateInterface({
                type: UpdateInterfaceType.CHANGE_TARGET_CONTENT,
                value: this.targetDeskMenuItemIndex,
                oldValue
            });
        }
    );

    private async _handleEnterDir() {
        const selectedContent = this.chosenDirContentsPath.at(this._indexTargetContent) as string;
        const contentPath = normalize( join(this._chosenDir, selectedContent) );

        const { ext } = pathParse(contentPath);
        const isDirectory = !ext;

        // Rewrite interface if active content was changed
        if ( this._activeChosenDirContent?.path !== contentPath ) {
            this._keydownObserver.activate(KeyDownEvents.CHANGE, TargetTerminalSpace.DESK_MENU);
            this._activeChosenDirContent = {
                path: contentPath,
                isDir: isDirectory
            };
            
            const handler = this._keydownObserver.handlerEnterWrapper(this._updateInterface.bind(this));

            await handler({
                type: UpdateInterfaceType.CHANGE_TARGET_SPACE
            });
        }
    }

    private async _handleEnterDesk() {
        if ( !this._activeChosenDirContent ) {
            throw new TypeError('There is no active dir content');
        }

        const deskMenu = this._activeChosenDirContent.isDir ? this.DESK_MENU_DIR : this.DESK_MENU_FILE;
        const targetDeskMenuItem = deskMenu.at(this.targetDeskMenuItemIndex);
        const handler = this._keydownObserver.handlerEnterWrapper(this._updateInterface.bind(this));

        switch(targetDeskMenuItem) {
            case 'BACK':
                {
                    this._keydownObserver.activate(KeyDownEvents.CHANGE, TargetTerminalSpace.WORKING_DIR);
                    this.targetDeskMenuItemIndex = 0;
                    this._activeChosenDirContent = null;

                    await handler({
                        type: UpdateInterfaceType.CHANGE_TARGET_SPACE
                    });   
                }             
                break;
            case 'DELETE':
                {
                    const chosenDirContentsPath = this.chosenDirContentsPath.at(this.indexTargetContent) as string;
                    const oldValue = this.chosenDirContentsPath;

                    await this._rm(chosenDirContentsPath);
                    this._setIsNeedToWriteArrows();

                    this._keydownObserver.activate(KeyDownEvents.CHANGE, TargetTerminalSpace.WORKING_DIR);
                    this.targetDeskMenuItemIndex = 0;
                    this._indexTargetContent -= 1;
                    this._activeChosenDirContent = null;

                    await handler({
                        type: UpdateInterfaceType.REMOVE_CONTENT,
                        oldValue
                    });
                }
                break;
            case 'OPEN':
                {
                    const oldValue = this.chosenDirContentsPath;
                    const targetPath = this.chosenDirContentsPath.at(this._indexTargetContent) as string;
                    
                    await this._openDir(targetPath);
                    this._setIsNeedToWriteArrows();

                    this._keydownObserver.activate(KeyDownEvents.CHANGE, TargetTerminalSpace.WORKING_DIR);
                    this.targetDeskMenuItemIndex = 0;
                    this._activeChosenDirContent = null;

                    await handler({
                        type: UpdateInterfaceType.OPEN_DIR,
                        oldValue
                    });
                }
                break;
        }
    }

    private _handleBackward = this._keydownObserver.characterWrapper(
        async () => {
            if ( this._activeChosenDirContent ) return;

            if ( !this._contentsRange ) {
                throw new TypeError('_contentsRange is not defined');
            }

            if ( !this.contentsEndIndex ) {
                throw new TypeError('contentsEndIndex is not defined');
            }

            this.contentsStartIndex -= this._contentsRange;
            this.contentsEndIndex -= this._contentsRange;

            await this._readChosenDir();
            await this._writeInterface();
        }
    )

    private _handleForward = this._keydownObserver.characterWrapper(
        async () => {
            if ( this._activeChosenDirContent ) return;
    
            if ( !this._contentsRange ) {
                throw new TypeError('_contentsEndIndex is not defined');
            }

            if ( !this.contentsEndIndex ) {
                throw new TypeError('contentsEndIndex is not defined');
            }
    
            this.contentsStartIndex += this._contentsRange;
            this.contentsEndIndex += this._contentsRange;
    
            await this._readChosenDir();
            await this._writeInterface();
        }
    )

    private _normalizeWorkingDirLine(content: string, index?: number) {
        let workingDirLine = '';

        const { numColumns } = this.terminalSize;
        const isWorkingDirActive = this._keydownObserver.targetTerminalSpace === TargetTerminalSpace.WORKING_DIR;
        const isTarget = index === this.indexTargetContent && isWorkingDirActive;
        const horizontalBorder = `${this.ROW_CHARACTER}${this.ROW_PADDING}`;

        workingDirLine += horizontalBorder;
        workingDirLine += `${isTarget ? this.PROMPT : ''}${content}`;

        const allPaddingCount = numColumns - workingDirLine.length;

        if ( !this._deskPartLength ) {
            this._deskPartLength = Math.ceil(allPaddingCount * this.DESK_PART);
        }

        const rightPaddingCount = allPaddingCount - this._deskPartLength - 2;
        const rightPadding = ' '.repeat(rightPaddingCount);

        workingDirLine += rightPadding;

        return workingDirLine;
    }

    protected *_writeWorkingDir() {        
        let needToWriteWorkingDirEmptyLine = false;

        for ( let i = 0; i < this.chosenDirContentsInterface.length * 2; i++ ) {
            let workingDirLine = '';

            if ( needToWriteWorkingDirEmptyLine ) {
                workingDirLine = this.workingDirEmptyLine;
                needToWriteWorkingDirEmptyLine = false;
            } else {
                const contentIndex = i / 2;
                const content = this.chosenDirContentsInterface.at(contentIndex) as string;

                workingDirLine = this._normalizeWorkingDirLine(content, contentIndex);
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

    protected *_writeDeskMenu() {
        if ( !this._deskPartLength ) {
            throw new TypeError('deskPartLength was not defined');
        }

        if ( this._activeChosenDirContent ) {
            const deskMenuItems = this._activeChosenDirContent.isDir ? this.DESK_MENU_DIR : this.DESK_MENU_FILE;
            const longestItemLength = Math.max( ...deskMenuItems.map(item => item.length) );

            let deskMenuItemIndex = 0;

            for ( const deskMenuItem of deskMenuItems ) {
                const horizontalBorder = this.COLUMN_CHARACTER.repeat(longestItemLength + 4);
                let horizontalBorderLine = this._centredDeskMenuItem(horizontalBorder, this._deskPartLength);
                horizontalBorderLine = this._borderedDeskMenuItem(horizontalBorderLine);

                yield `${horizontalBorderLine}${this.END_LINE}`;

                let innerLeftPaddingCount = (horizontalBorder.length - deskMenuItem.length - 2) / 2;

                if ( innerLeftPaddingCount % 2 !== 0 ) {
                    innerLeftPaddingCount = Math.ceil(innerLeftPaddingCount);
                }

                const innerRightPaddingCount = innerLeftPaddingCount;

                const innerLeftPadding = ' '.repeat(innerLeftPaddingCount);
                const innerRightPadding = ' '.repeat(innerRightPaddingCount);
                const isDeskMenuItemTarget = this.targetDeskMenuItemIndex === deskMenuItemIndex
                    && this._keydownObserver.targetTerminalSpace === TargetTerminalSpace.DESK_MENU;

                let deskItemLine = `${innerLeftPadding}${deskMenuItem}${innerRightPadding}`;

                deskItemLine = this._borderedDeskMenuItem(deskItemLine);
                deskItemLine = this._centredDeskMenuItem(deskItemLine, this._deskPartLength, isDeskMenuItemTarget);
                deskItemLine = this._borderedDeskMenuItem(deskItemLine);

                yield `${deskItemLine}${this.END_LINE}`;

                yield `${horizontalBorderLine}${this.END_LINE}`;

                deskMenuItemIndex++;
            }
        }

        while(true) {
            const leftPadding = ' '.repeat(this._deskPartLength);

            let deskMenuLine = leftPadding;
            deskMenuLine = this._borderedDeskMenuItem(deskMenuLine);

            yield `${deskMenuLine}${this.END_LINE}`;
        }
    }
}

class KeyDownObserver extends EventEmitter {
    private _isCalldown = false;
    private _readline = new Readline(stdout);
    private _rl: Interface;

    public targetTerminalSpace: TargetTerminalSpace = TargetTerminalSpace.WORKING_DIR;

    constructor(rl: Interface) {
        super();

        this._rl = rl;

        this._on(KeyDownEvents.CHANGE, (targetSpace: TargetTerminalSpace) => {
            this.targetTerminalSpace = targetSpace;
        });

        stdin.on('keypress', this._handleKeypress.bind(this));
    }

    private _on<TArg = unknown>(event: KeyDownEvents, workingDirCb: AnyFunc<TArg>, deskMenuCb?: AnyFunc<TArg>) {
        const handler: AnyFunc<TArg> = async (...args: TArg[]) => {
            if ( this.targetTerminalSpace === TargetTerminalSpace.WORKING_DIR || !deskMenuCb) {
                await workingDirCb(...args);
            } else {
                await deskMenuCb(...args);
            }
        }

        super.on(KeyDownEvents[event], handler);

        return this;
    }

    private async _handleKeypress(_s: string | undefined, key: Key) {
        const { ctrl, name } = key;

        if ( ctrl && name === 'c' ) {
            this._rl.write(null, {
                ctrl: true,
                name: 'l'
            });

            process.exit(0);
        }

        let keyName: KeyDownEventsKeys;

        switch(name) {
            case 'return':
                keyName = 'ENTER';
                break;
            case 'b':
                keyName = 'BACKWARD';
                break;
            case 'f':
                keyName = 'FORWARD';
                break;
            default:
                keyName = name?.toUpperCase() as KeyDownEventsKeys;
                break;
        }

        this.activate(KeyDownEvents[keyName]);
    }

    public activate<TArgs>(event: KeyDownEvents, ...args: TArgs[]) {
        return super.emit(KeyDownEvents[event], ...args);
    }

    public onDown(workingDirCb: AnyFunc, deskMenuCb: AnyFunc) {
        return this._on(KeyDownEvents.DOWN, workingDirCb, deskMenuCb);
    }

    public onUp(workingDirCb: AnyFunc, deskMenuCb: AnyFunc) {
        return this._on(KeyDownEvents.UP, workingDirCb, deskMenuCb);
    }

    public onEnter(workingDirCb: AnyFunc, deskMenuCb: AnyFunc) {
        return this._on(KeyDownEvents.ENTER, workingDirCb, deskMenuCb);
    }

    public onBackward(cb: AnyFunc) {
        return this._on(KeyDownEvents.BACKWARD, cb);
    }

    public onForward(cb: AnyFunc) {
        return this._on(KeyDownEvents.FORWARD, cb);
    }

    public handlerEnterWrapper<TArg = unknown>(handler: AnyFunc<TArg>) {
        return new Proxy(handler, {
            apply: async (target, thisArg, argArray) => {
                await this._readline
                    .moveCursor(0, -1)
                    .commit();

                const result = await Reflect.apply(target, thisArg, argArray);

                return result;
            },
        })
    }

    public calldownWrapper(fn: AnyFunc) {
        return new Proxy(fn, {
            apply: async (target, thisArg, argArray) => {
                if ( this._isCalldown ) return;
                this._isCalldown = true;

                const result = await Reflect.apply(target, thisArg, argArray);

                this._isCalldown = false;

                return result;
            }
        })
    }

    public characterWrapper(fn: AnyFunc) {
        return new Proxy(fn, {
            apply: async (target, thisArg, argArray) => {
                this._rl.write(null, {
                    ctrl: true,
                    name: 'u'
                });

                const result = await Reflect.apply(target, thisArg, argArray);

                return result;
            }
        })
    }
}

class UpdateInterfaceHandlers {
    private _getStartDeskMenuCoords(this: FileManagerInterface): IStartCoords {
        if ( !this._deskPartLength ) {
            throw new TypeError('deskPartLength was not defined');
        }

        const { numColumns } = this.terminalSize;
        let dy = -(this.chosenDirContentsPath.length * 2) - 1;

        if ( this._needToWriteArrows ) {
            dy -= 1;
        }

        if ( this.isThereRestLines ) {
            dy -= this.restLines
        }

        const dx = numColumns - this._deskPartLength - 2;

        return ({ dx, dy });
    }

    private _getStartWorkingDirCoords(this: FileManagerInterface): IStartCoords {
        let dy = -(this.chosenDirContentsPath.length * 2) - 1;

        if ( this._needToWriteArrows ) {
            dy -= 1;
        }

        if ( this.isThereRestLines ) {
            dy -= this.restLines
        }

        const dx = 0;
        
        return ({ dx, dy });
    }

    public async workingDirTargetContent(this: FileManagerInterface, value: number, oldValue: number) {
        const { dx, dy } = this._updateInterfaceHandlers._getStartWorkingDirCoords.call(this);

        await this._readline
            .moveCursor(dx, dy)
            .commit();

        const contentsLength = this.chosenDirContentsPath.length;
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

        if ( isToDownFromStart && this._needToWriteArrows ) {
            dy_3 += 1;
        }

        if ( isToDownFromStart && this.isThereRestLines ) {
            dy_3 += this.restLines;
        }

        const writeWorkingDirGen = this._writeWorkingDir();
        const writeWorkingDirArr = Array.from(writeWorkingDirGen);
        const line = writeWorkingDirArr.at(value * 2) as string;
        const prevLine = writeWorkingDirArr.at(oldValue * 2) as string;
        const deskMenuGen = this._writeDeskMenu();
        const { value: deskMenuValue } = deskMenuGen.next();

        await this._readline
            .moveCursor(0, dy_1)
            .clearLine(1)
            .commit();

        this._rl.write(`${prevLine}${deskMenuValue}`);

        await this._readline
            .moveCursor(0, dy_2 - 1)
            .clearLine(1)
            .commit();

        this._rl.write(`${line}${deskMenuValue}`);

        await this._readline
            .moveCursor(0, dy_3 - 1)
            .commit();
    }

    public async writingDeskMenu(this: FileManagerInterface) {
        const { dx, dy } = this._updateInterfaceHandlers._getStartDeskMenuCoords.call(this);
        const writeDeskMenuGen = this._writeDeskMenu();

        let deskMenuItems: string[] | null = null;

        if ( this._activeChosenDirContent ) {
            deskMenuItems = this._activeChosenDirContent.isDir ? this.DESK_MENU_DIR : this.DESK_MENU_FILE;
        }
        
        await this._readline
            .moveCursor(dx, dy)
            .commit();

        const length = deskMenuItems ? deskMenuItems.length * 3 : this.chosenDirContentsInterface.length * 2;

        for ( let i = 1; i <= length; i++ ) {
            await this._readline
                .clearLine(1)
                .commit();
            
            const { value: deskMenuValue } = writeDeskMenuGen.next();
            this._rl.write(deskMenuValue as string);

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

            if ( this._needToWriteArrows ) {
                dy_1 += 1;
            }
    
            if ( this.isThereRestLines ) {
                dy_1 += this.restLines;
            }
        }

        await this._readline
            .moveCursor(dx_1, dy_1)
            .commit();
    }
}