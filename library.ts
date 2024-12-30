import { stdin, stdout } from "process";
import { createInterface, Readline } from "readline/promises";
import { join, resolve, normalize, parse as pathParse } from "path";
import { readdir, stat } from "fs/promises";
import { EventEmitter } from "events";

import type {
    Key
} from "readline";
import type {
    IChosenDirContent,
    IActiveChosenContent,
    KeyDownEvents,
    AnyFunc,
    TargetTerminalSpace,
    IUpdateInterface,
    DeskMenuGen,
    IStartDeskMenuCoords
} from "./types";

class FileManager {
    private COUNT_OF_DIR_CONTENTS = Infinity;
    protected DESK_PART = 1 / 3;
    private UPPER_DIR: IChosenDirContent = {
        path: '../',
        displayPath: '../'
    };

    protected _chosenDir: string;
    protected _chosenDirContents: IChosenDirContent[] = [this.UPPER_DIR];
    protected _indexTargetContent = 0;

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

    constructor(startDir = '') {
        this._chosenDir = startDir.startsWith('/') ? startDir : resolve(startDir);
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
            const maxContentLength = Math.floor(numColumns - numColumns * this.DESK_PART) - 5;

            let displayContent = `${normalizedTime} ${normalizedSize} ${dirContent}`;

            if ( displayContent.length > maxContentLength ) {
                displayContent = displayContent.slice(0, maxContentLength - 3).concat('...');
            }

            return ({
                path: dirContent,
                displayPath: displayContent
            });
        } catch (error) {
            const displayContent = `? ? ${dirContent}`;

            return({
                path: dirContent,
                displayPath: displayContent
            });
        }
    }

    protected async _readChosenDir(startIndex = 0) {
        let dirContents = await readdir(this._chosenDir);
        dirContents = dirContents.slice(startIndex, this.COUNT_OF_DIR_CONTENTS);

        // Reset chosen dir contents
        this._chosenDirContents = new Array(dirContents.length + 1);
        this._chosenDirContents[0] = this.UPPER_DIR;
        
        for ( let i = 0; i < Math.ceil(dirContents.length / 2); i++ ) {
            let dirContent = dirContents.at(i) as string;
            let dirLastContent = dirContents.at(-1 - i) as string;

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
        this._chosenDir = normalize( join(this._chosenDir, contentPath) );
        this.indexTargetContent = 0;

        await this._readChosenDir();
    }

    protected async rm(contentPath: string) {

    }
}

export default class FileManagerInterface extends FileManager {
    private PROMPT = '> ';
    private ROW_CHARACTER = '|';
    private COLUMN_CHARACTER = '-'
    private ROW_PADDING = ' '.repeat(2);
    
    // Writing desk menu constants
    protected DESK_MENU_FILE = ['RENAME', 'DELETE', 'BACK'];
    protected DESK_MENU_DIR = [...this.DESK_MENU_FILE, 'OPEN'];
    protected END_LINE = '\n';

    protected _deskPartLength: number | null = null;
    protected _activeChosenDirContent: IActiveChosenContent | null = null;

    private _keydownObserver = new KeyDownObserver();
    private _targetDeskMenuItemIndex = 0;
    private _resizeTimeout: NodeJS.Timeout | null = null;

    protected _rl = createInterface({
        input: stdin,
        output: stdout,
        terminal: true,
        historySize: 0,
        prompt: ''
    });
    protected _readline = new Readline(stdout);
    protected _updateInterfaceHandlers = new UpdateInterfaceHandlers();

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

    protected get numColumns() {
        let [ numColumns ] = stdout.getWindowSize();
        numColumns -= 1;

        return numColumns;
    }

    constructor(startDir = '') {
        super(startDir);

        process.on('SIGWINCH', () => {
            if ( this._resizeTimeout ) {
                clearTimeout(this._resizeTimeout);
                this._resizeTimeout = null;
            }

            this._resizeTimeout = setTimeout(
                () => this._handleResizeTerminal(),
                100
            );
        });
        
        this._keydownObserver.onDown(this._handleDownDir.bind(this), this._handleDownDesk.bind(this));
        this._keydownObserver.onUp(this._handleUpDir.bind(this), this._handleUpDesk.bind(this));
        this._keydownObserver.onEnter(this._handleEnterDir.bind(this), this._handleEnterDesk.bind(this));

        this._initilize();
    }

    private async _initilize() {
        await this._readChosenDir();
        await this._writeInterface();
        
        stdin.on('keypress', this._handleKeypress.bind(this));
    }

    private async _writeInterface() {
        let interfaceStr = '';
        const numColumns = this.numColumns;

        let horizontalBorder = this.COLUMN_CHARACTER.repeat(numColumns);
        interfaceStr += horizontalBorder;

        const workingDirGen = this._writeWorkingDir(numColumns);
        let deskMenuGen: DeskMenuGen = null;
        let needToWriteWorkingDirLine = true;

        while(true) {
            let interfaceLine = '';

            if ( needToWriteWorkingDirLine ) {
                const { done, value: workingDirLine } = workingDirGen.next();

                if ( done ) {
                    break;
                }

                if ( !deskMenuGen ) {
                    deskMenuGen = this._writeDeskMenu();
                }

                const { value: deskMenuLine } = deskMenuGen.next();

                interfaceLine += `${workingDirLine}${deskMenuLine}`;

                needToWriteWorkingDirLine = false;
            } else {
                if ( !this._deskPartLength ) {
                    throw new TypeError('deskPartLength was not defined');
                }

                const workingDirPartLength = numColumns - this._deskPartLength - 3;
                const workingDirPart = ' '.repeat(workingDirPartLength);
                const { value: deskMenuLine } = deskMenuGen!.next();

                interfaceLine += `${this.END_LINE}${this.ROW_CHARACTER}${workingDirPart}${deskMenuLine}`;

                needToWriteWorkingDirLine = true;
            }

            interfaceStr += interfaceLine;
        }

        interfaceStr += `${this.END_LINE}${horizontalBorder}${this.END_LINE}`;

        this._rl.write(interfaceStr);
    }

    private async _handleResizeTerminal() {
        // Reset all sizes of terminal
        this._deskPartLength = null;

        await this._readline
            .cursorTo(0, 0)
            .commit();

        this._rl.write(null, {
            ctrl: true,
            name: 'l'
        });

        await this._writeInterface();
    }

    protected *_writeWorkingDir(numColumns: number) {
        for ( let i = 0; i < this.chosenDirContentsInterface.length; i++ ) {
            const content = this.chosenDirContentsInterface.at(i) as string;
            let workingDirLine = '';

            const isWorkingDirActive = this._keydownObserver.targetTerminalSpace === 'workingDir';
            const isTarget = i === this.indexTargetContent && isWorkingDirActive;
            const horizontalBorder = `${this.END_LINE}${this.ROW_CHARACTER}${this.ROW_PADDING}`;

            workingDirLine += horizontalBorder;
            workingDirLine += `${isTarget ? this.PROMPT : ''}${content}`;

            const allPaddingCount = numColumns - workingDirLine.length;

            if ( !this._deskPartLength ) {
                this._deskPartLength = Math.ceil(allPaddingCount * this.DESK_PART);
            }

            const rightPaddingCount = allPaddingCount - this._deskPartLength - 1;
            const rightPadding = ' '.repeat(rightPaddingCount);

            workingDirLine += rightPadding;

            yield workingDirLine;
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
                let horizontalBorder = this.COLUMN_CHARACTER.repeat(longestItemLength + 4);
                let horizontalBorderLine = this._centredDeskMenuItem(horizontalBorder, this._deskPartLength);
                horizontalBorderLine = this._borderedDeskMenuItem(horizontalBorderLine);

                yield horizontalBorderLine;

                let innerLeftPaddingCount = (horizontalBorder.length - deskMenuItem.length - 2) / 2;
                let innerRightPaddingCount: number;

                if ( innerLeftPaddingCount % 2 !== 0 ) {
                    innerLeftPaddingCount = Math.ceil(innerLeftPaddingCount);
                }

                innerRightPaddingCount = innerLeftPaddingCount;

                const innerLeftPadding = ' '.repeat(innerLeftPaddingCount);
                const innerRightPadding = ' '.repeat(innerRightPaddingCount);
                const isDeskMenuItemTarget = this.targetDeskMenuItemIndex === deskMenuItemIndex && this._keydownObserver.targetTerminalSpace === 'deskMenu';

                let deskItemLine = `${innerLeftPadding}${deskMenuItem}${innerRightPadding}`;

                deskItemLine = this._borderedDeskMenuItem(deskItemLine);
                deskItemLine = this._centredDeskMenuItem(deskItemLine, this._deskPartLength, isDeskMenuItemTarget);
                deskItemLine = this._borderedDeskMenuItem(deskItemLine);

                yield deskItemLine;

                yield `${horizontalBorderLine}${this.END_LINE}`;

                deskMenuItemIndex++;
            }
        }

        while(true) {
            const leftPadding = ' '.repeat(this._deskPartLength);

            let deskMenuLine = leftPadding;
            deskMenuLine = this._borderedDeskMenuItem(deskMenuLine);

            yield deskMenuLine;
        }
    }

    private _centredDeskMenuItem(item: string, totalLength: number, isItemTarget = false) {
        if ( isItemTarget ) {
            totalLength -= 4;
        }

        const itemStartPosition = Math.ceil(totalLength / 2);
        const itemStartIndex = Math.ceil(item.length / 2);
        let leftPaddingCount = Math.ceil(itemStartPosition - itemStartIndex);
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
            case 'changeTargetContent':
                {
                    if ( typeof value !== 'number' || typeof oldValue !== 'number' ) {
                        throw new TypeError('Inf`s value should be the numbers');
                    }

                    let handler: AnyFunc<any, Promise<void>>;
    
                    if ( this._keydownObserver.targetTerminalSpace === 'workingDir' ) {
                        handler = this._updateInterfaceHandlers.workingDirTargetContent.bind(this);
                    } else {
                        await this._readline
                            .moveCursor(0, 1)
                            .commit()

                        handler = this._updateInterfaceHandlers.writeDeskMenu.bind(this);
                    }

                    await handler(value, oldValue);
                }
                break;
            case 'changeTargetSpace':
                {
                    const handler = this._updateInterfaceHandlers.writeDeskMenu.bind(this);
                    await handler();
                }
                break;
        }
    }

    private async _handleKeypress(_s: string | undefined, key: Key) {
        if ( key.ctrl && key.name === 'c' ) {
            this._rl.write(null, {
                ctrl: true,
                name: 'l'
            });

            process.exit(0);
        }

        // console.log(key);

        switch(key.name) {
            case 'up':
                // this._handleUp();
                this._keydownObserver.emit('up');
                break;
            case 'down':
                // this._handleDown();
                this._keydownObserver.emit('down');
                break;
            case 'return':
                // await this._handleEnter();
                this._keydownObserver.emit('enter');
                break;
        }
    }

    private async _handleUpDir() {
        const oldValue = this.indexTargetContent;
        this.indexTargetContent--;

        await this._updateInterface({
            type: 'changeTargetContent',
            value: this.indexTargetContent,
            oldValue
        });
    }

    private async _handleDownDir() {
        const oldValue = this.indexTargetContent;
        this.indexTargetContent++;

        await this._updateInterface({
            type: 'changeTargetContent',
            value: this.indexTargetContent,
            oldValue
        });
    }

    private async _handleUpDesk() {
        const oldValue = this.targetDeskMenuItemIndex;
        this.targetDeskMenuItemIndex--;

        await this._updateInterface({
            type: 'changeTargetContent',
            value: this.targetDeskMenuItemIndex,
            oldValue
        });
    }

    private async _handleDownDesk() {
        const oldValue = this.targetDeskMenuItemIndex;
        this.targetDeskMenuItemIndex++;

        await this._updateInterface({
            type: 'changeTargetContent',
            value: this.targetDeskMenuItemIndex,
            oldValue
        });
    }

    private async _handleEnterDir() {
        const selectedContent = this.chosenDirContentsPath.at(this._indexTargetContent) as string;
        const contentPath = normalize( join(this._chosenDir, selectedContent) );

        const { ext } = pathParse(contentPath);
        const isDirectory = !ext;

        // Rewrite interface if active content was changed
        if ( this._activeChosenDirContent?.path !== contentPath ) {
            this._keydownObserver.emit('change', 'deskMenu');
            this._activeChosenDirContent = {
                path: contentPath,
                isDir: isDirectory
            };
            this._updateInterface({
                type: 'changeTargetSpace'
            });
        }
    }

    private async _handleEnterDesk() {
        if ( !this._activeChosenDirContent ) {
            throw new TypeError('There is no active dir content');
        }

        const deskMenu = this._activeChosenDirContent.isDir ? this.DESK_MENU_DIR : this.DESK_MENU_FILE;
        const targetDeskMenuItem = deskMenu.at(this.targetDeskMenuItemIndex);

        switch(targetDeskMenuItem) {
            case 'BACK':
                this._keydownObserver.emit('change', 'workingDir');
                this.targetDeskMenuItemIndex = 0;
                this._activeChosenDirContent = null;

                await this._updateInterface({
                    type: 'changeTargetSpace'
                });                
                break;
            case 'DELETE':

                break;
            case 'OPEN':
                let targetPath = this.chosenDirContentsPath.at(this._indexTargetContent) as string;
                
                await this._openDir(targetPath);

                this._keydownObserver.emit('change', 'workingDir');
                this.targetDeskMenuItemIndex = 0;
                this._activeChosenDirContent = null;
                break;
        }
    }
}

class KeyDownObserver extends EventEmitter {
    public targetTerminalSpace: TargetTerminalSpace = 'workingDir';

    constructor() {
        super();

        this.on('change', (targetSpace: TargetTerminalSpace) => {
            this.targetTerminalSpace = targetSpace; 
        });
    }

    private _onEvent(event: KeyDownEvents, workingDirCb: AnyFunc, deskMenuCb: AnyFunc) {
        this.on(event, () => {
            if ( this.targetTerminalSpace === 'deskMenu' ) {
                deskMenuCb();
            } else {
                workingDirCb();
            }
        });

        return this;
    }

    public emit(event: KeyDownEvents, ...args: any[]) {
        return super.emit(event, ...args);
    }

    public onDown(workingDirCb: AnyFunc, deskMenuCb: AnyFunc) {
        return this._onEvent('down', workingDirCb, deskMenuCb);
    }

    public onUp(workingDirCb: AnyFunc, deskMenuCb: AnyFunc) {
        return this._onEvent('up', workingDirCb, deskMenuCb);
    }

    public onEnter(workingDirCb: AnyFunc, deskMenuCb: AnyFunc) {
        return this._onEvent('enter', workingDirCb, deskMenuCb);
    }
}

class UpdateInterfaceHandlers {
    private _getStartDeskMenuCoords(this: FileManagerInterface): IStartDeskMenuCoords {
        if ( !this._deskPartLength ) {
            throw new TypeError('deskPartLength was not defined');
        }

        const dy = -(this.chosenDirContentsPath.length * 2) - 2;
        const dx = this.numColumns - this._deskPartLength - 2;

        return ({ dx, dy });
    }

    public async workingDirTargetContent(this: FileManagerInterface, value: number, oldValue: number) {
        const isToStartFromDown = value === 0 && oldValue === this.chosenDirContentsPath.length - 1;
        const isToDownFromStart = value === this.chosenDirContentsPath.length - 1 && oldValue === 0;
        const isDown = value > oldValue || isToStartFromDown;
        const dy_1 = -(this.chosenDirContentsPath.length - value) * 2 - 1;
        const dy_2 = isToStartFromDown ? (this.chosenDirContentsPath.length - 1) * 2 :
            isToDownFromStart ? -(this.chosenDirContentsPath.length - 1) * 2 :
            isDown ? -2 : 2;
        const dy_3 = (this.chosenDirContentsPath.length - oldValue) * 2;
        const numColumns = this.numColumns;

        const writeWorkingDirGen = this._writeWorkingDir(numColumns);
        const writeWorkingDirArr = Array.from(writeWorkingDirGen);
        const line = writeWorkingDirArr.at(value) as string;
        const prevLine = writeWorkingDirArr.at(oldValue) as string;
        const deskMenuGen = this._writeDeskMenu();
        const { value: deskMenuValue } = deskMenuGen.next();

        await this._readline
            .moveCursor(0, dy_1)
            .clearLine(1)
            .moveCursor(0, -1)
            .commit();

        this._rl.write(`${line}${deskMenuValue}${this.END_LINE}`);

        await this._readline
            .moveCursor(0, -1)
            .moveCursor(0, dy_2)
            .clearLine(1)
            .moveCursor(0, -1)
            .commit();

        this._rl.write(`${prevLine}${deskMenuValue}${this.END_LINE}`);

        await this._readline
            .moveCursor(0, dy_3)
            .commit();
    }

    public async writeDeskMenu(this: FileManagerInterface) {
        const writeDeskMenuGen = this._writeDeskMenu();
        const { dx, dy } = this._updateInterfaceHandlers._getStartDeskMenuCoords.call(this);
        const workingDirLength = this.chosenDirContentsPath.length * 2;
        let deskMenuItems: string[] | null = null;

        if ( this._activeChosenDirContent ) {
            deskMenuItems = this._activeChosenDirContent.isDir ? this.DESK_MENU_DIR : this.DESK_MENU_FILE;
        }
        
        await this._readline
            .moveCursor(dx, dy)
            .commit();

        const length = deskMenuItems ? deskMenuItems.length * 3 : workingDirLength;

        for ( let i = 1; i <= length; i++ ) {
            await this._readline
                .clearLine(1)
                .commit();
            
            const { value: deskMenuValue } = writeDeskMenuGen.next();
            this._rl.write(`${deskMenuValue}${this.END_LINE}`);

            await this._readline
                .moveCursor(dx, 0)
                .commit();
        }

        if ( deskMenuItems ) {
            let dy_1 = Math.abs(dy) - (deskMenuItems.length + 2) * 3;
            const dx_1 = -dx;

            if ( !this._activeChosenDirContent?.isDir ) {
                dy_1 += 1;
            }

            await this._readline
                .moveCursor(dx_1, dy_1)
                .moveCursor(0, 1)
                .commit();
        } else {
            await this._readline
                .moveCursor(-dx, 1)
                .commit();
        }
    }
}