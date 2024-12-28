import { stdin, stdout } from "process";
import { createInterface, Readline } from "readline/promises";
import { join, resolve, normalize, parse as pathParse } from "path";
import { readdir, stat } from "fs/promises";
import { EventEmitter } from "events";
import { promisify } from "util";

import { moveCursor, type Key } from "readline";
import type {
    IChosenDirContent,
    IActiveChosenContent,
    KeyDownEvents,
    AnyFunc,
    TargetTerminalSpace,
    IUpdateInterface,
    DeskMenuGen
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
    private DESK_MENU_FILE = ['RENAME', 'DELETE', 'BACK'];
    private DESK_MENU_DIR = [...this.DESK_MENU_FILE, 'OPEN'];

    private _deskPartLength: number | null = null;
    private _activeChosenDirContent: IActiveChosenContent | null = null;
    private _keydownObserver = new KeyDownObserver();
    private _targetDeskMenuItemIndex = 0;
    private _rl = createInterface({
        input: stdin,
        output: stdout,
        terminal: true,
        historySize: 0,
        prompt: ''
    });
    private _readline = new Readline(stdout);

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

    private get numColumns() {
        let [ numColumns ] = stdout.getWindowSize();
        numColumns -= 1;

        return numColumns;
    }

    constructor(startDir = '') {
        super(startDir);

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
                const deskPartLength = Math.ceil(numColumns * this.DESK_PART) - 1;
                const workingDirPartLength = Math.floor(numColumns - deskPartLength);
                const { value: deskMenuLine } = deskMenuGen!.next();

                interfaceLine += `\n${this.ROW_CHARACTER}${' '.repeat(workingDirPartLength)}${deskMenuLine}`;

                needToWriteWorkingDirLine = true;
            }

            interfaceStr += interfaceLine;
        }

        interfaceStr += `\n${horizontalBorder}\n`;

        this._rl.write(interfaceStr);
    }

    private *_writeWorkingDir(numColumns: number) {
        for ( let i = 0; i < this.chosenDirContentsInterface.length; i++ ) {
            const content = this.chosenDirContentsInterface.at(i) as string;
            let workingDirLine = '';

            const isWorkingDirActive = this._keydownObserver.targetTerminalSpace === 'workingDir';
            const isTarget = i === this.indexTargetContent && isWorkingDirActive;
            const horizontalBorder = `\n${this.ROW_CHARACTER}${this.ROW_PADDING}`;

            workingDirLine += horizontalBorder;
            workingDirLine += `${isTarget ? this.PROMPT : ''}${content}`;

            const allPaddingCount = numColumns - workingDirLine.length - 2;

            if ( !this._deskPartLength ) {
                this._deskPartLength = Math.ceil(allPaddingCount * this.DESK_PART);
            }

            const rightPaddingCount = Math.abs( Math.ceil(allPaddingCount - this._deskPartLength) ) + 1;
            const rightPadding = ' '.repeat(rightPaddingCount);

            workingDirLine += rightPadding;

            yield workingDirLine;
        }
    }

    private *_writeDeskMenu() {
        if ( !this._deskPartLength ) {
            throw new TypeError('deskPartLength was not defined');
        }

        if ( this._activeChosenDirContent ) {
            const deskMenuItems = this._activeChosenDirContent.isDir ? this.DESK_MENU_DIR : this.DESK_MENU_FILE;
            const longestItemLength = Math.max( ...deskMenuItems.map(item => item.length) );

            let deskMenuItemIndex = 0;

            for ( const deskMenuItem of deskMenuItems ) {
                let horizontalBorder = this.COLUMN_CHARACTER.repeat(longestItemLength + 4);
                let horizontalBorderCentered = this._centredDeskMenuItem(horizontalBorder, this._deskPartLength);
                horizontalBorderCentered = this._borderedDeskMenuItem(horizontalBorder);

                yield horizontalBorderCentered;

                let innerLeftPaddingCount = (horizontalBorder.length - deskMenuItem.length - 2) / 2;
                let innerRightPaddingCount: number;

                if ( innerLeftPaddingCount % 2 !== 0 ) {
                    innerLeftPaddingCount = Math.ceil(innerLeftPaddingCount);
                }

                innerRightPaddingCount = innerLeftPaddingCount;

                const isDeskMenuItemTarget = this.targetDeskMenuItemIndex === deskMenuItemIndex && this._keydownObserver.targetTerminalSpace === 'deskMenu';
                let deskItemLine = `${this.ROW_CHARACTER}${' '.repeat(innerLeftPaddingCount)}${deskMenuItem}${' '.repeat(innerRightPaddingCount)}${this.ROW_CHARACTER}`;

                deskItemLine = this._centredDeskMenuItem(deskItemLine, this._deskPartLength, isDeskMenuItemTarget);
                deskItemLine = this._borderedDeskMenuItem(deskItemLine);

                yield deskItemLine;

                yield horizontalBorderCentered;

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
        let rightPaddingCount = Math.ceil(itemStartPosition - itemStartIndex);
        let leftPaddingCount = totalLength - item.length - rightPaddingCount;

        if ( isItemTarget ) {
            rightPaddingCount += 2;
        }
        
        return `${' '.repeat(leftPaddingCount)}${isItemTarget ? this.PROMPT : ''}${item}${' '.repeat(rightPaddingCount)}`;
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
                        throw new TypeError('oldValue and value are not a numbers');
                    }

                    const isToStartFromDown = value === 0 && oldValue === this.chosenDirContentsPath.length - 1;
                    const isToDownFromStart = value === this.chosenDirContentsPath.length - 1 && oldValue === 0;
                    const isDown = value > oldValue || isToStartFromDown;
                    const dy_1 = -Math.floor((this.chosenDirContentsPath.length - value) * 2) - 1;
                    const dy_2 = isToStartFromDown ? (this.chosenDirContentsPath.length - 1) * 2 :
                        isToDownFromStart ? -(this.chosenDirContentsPath.length - 1) * 2 :
                        isDown ? -2 : 2;
                    const dy_3 = (this.chosenDirContentsPath.length - oldValue + 1) * 2;
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

                    this._rl.write(`${line}${deskMenuValue}\n`);

                    await this._readline
                        .moveCursor(0, dy_2 - 1)
                        .clearLine(1)
                        .moveCursor(0, -1)
                        .commit();

                    this._rl.write(`${prevLine}${deskMenuValue}\n`);

                    await this._readline
                        .moveCursor(0, dy_3 - 1)
                        .commit();
                }
                break;
            case 'changeTargetSpace':

                break;
        }
    }

    private async _handleKeypress(_s: string | undefined, key: Key) {
        if ( key.ctrl && key.name === 'c' ) {
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
        this.targetDeskMenuItemIndex--;
    }

    private _handleDownDesk() {
        this.targetDeskMenuItemIndex++;
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