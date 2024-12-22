import { stdin, stdout } from "process";
import { createInterface } from "readline/promises";
import { join, resolve, normalize, parse as pathParse } from "path";
import { readdir, stat } from "fs/promises";
import { EventEmitter } from "events";

import type { Interface } from "readline/promises";
import type { Key } from "readline";
import type {
    IChosenDirContent,
    IActiveChosenContent,
    KeyDownEvents,
    AnyFunc,
    TargetTerminalSpace
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
    private HORIZONTAL_PADDING = ' '.repeat(2);
    
    // Writing desk menu constants
    private DESK_MENU_FILE = ['RENAME', 'DELETE', 'BACK'];
    private DESK_MENU_DIR = [...this.DESK_MENU_FILE, 'OPEN'];

    private _rl: Interface;
    private _activeChosenDirContent: IActiveChosenContent | null = null;
    private _keydownObserver = new KeyDownObserver();
    private _targetDeskMenuItemIndex = 0;

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

    constructor(startDir = '') {
        super(startDir);

        this._rl = createInterface({
            input: stdin,
            output: stdout,
            terminal: true,
            historySize: 0,
            prompt: ''
        });

        this._keydownObserver.onDown(this._handleDownDir.bind(this), this._handleDownDesk.bind(this));
        this._keydownObserver.onUp(this._handleUpDir.bind(this), this._handleUpDesk.bind(this));
        this._keydownObserver.onEnter(this._handleEnterDir.bind(this), this._handleEnterDesk.bind(this));

        this._initilize();
    }

    private async _initilize() {
        await this._readChosenDir();
        this._writeInterface();
        
        stdin.on('keypress', this._handleKeypress.bind(this));
    }

    private _writeInterface() {
        // Clearing stdout (console)
        this._rl.write(null, {
            ctrl: true,
            name: 'l'
        });

        // console.dir(this._chosenDirContents);

        let [ numColumns ] = stdout.getWindowSize();
        numColumns -= 1;

        let interfaceStr = '';
        let horizontalBorder = this.COLUMN_CHARACTER.repeat(numColumns);
        interfaceStr += `${horizontalBorder}\n`;

        const workingDirGen = this._writeWorkingDir(numColumns);
        let deskMenuGen: Generator<string, void, unknown> | null = null;
        let needToWriteWorkingDirLine = true;
        
        while(true) {
            let interfaceLine = '';

            if ( needToWriteWorkingDirLine ) {
                const { done, value: workingDirValue } = workingDirGen.next();

                if ( done ) {
                    break;
                }

                const [ workingDirLine, deskPartLength ] = workingDirValue;

                if ( !deskMenuGen ) {
                    deskMenuGen = this._writeDeskMenu(deskPartLength);
                }

                const { value: deskMenuLine } = deskMenuGen.next();

                interfaceLine += `${workingDirLine}${this.ROW_CHARACTER}${deskMenuLine}`;
                interfaceLine += `${this.ROW_CHARACTER}\n`;

                needToWriteWorkingDirLine = false;
            } else {
                const deskPartPaddingLength = Math.ceil(numColumns * this.DESK_PART) - 1;
                const workingDirPartLength = Math.floor(numColumns - deskPartPaddingLength);

                interfaceLine += `${this.ROW_CHARACTER}${' '.repeat(workingDirPartLength)}${this.ROW_CHARACTER}`;

                const { value: deskMenuLine } = deskMenuGen!.next();

                interfaceLine += `${deskMenuLine}${this.ROW_CHARACTER}\n`;

                needToWriteWorkingDirLine = true;
            }

            interfaceStr += interfaceLine;
        }

        interfaceStr += `${horizontalBorder}\n`;

        this._rl.write(interfaceStr);
    }

    private *_writeWorkingDir(numColumns: number) {
        let contentIndex = 0;
        let deskPartLength: number | null = null;

        for ( let content of this.chosenDirContentsInterface ) {
            let workingDirLine = '';

            const isWorkingDirActive = this._keydownObserver.targetTerminalSpace === 'workingDir';
            const isTarget = contentIndex === this.indexTargetContent && isWorkingDirActive;
            const horizontalBorder = `${this.ROW_CHARACTER}${this.HORIZONTAL_PADDING}`;

            workingDirLine += horizontalBorder;
            workingDirLine += `${isTarget ? this.PROMPT : ''}${content}`;

            const allPaddingCount = numColumns - workingDirLine.length - 2;

            if ( !deskPartLength ) {
                deskPartLength = Math.ceil(allPaddingCount * this.DESK_PART) - 1;
            }

            const rightPaddingCount = Math.abs( Math.ceil(allPaddingCount - deskPartLength) );
            const rightPadding = ' '.repeat(rightPaddingCount);

            workingDirLine += rightPadding;

            contentIndex++;

            yield [ workingDirLine, deskPartLength ] as [ string, number ];
        }
    }

    private *_writeDeskMenu(deskPartLength: number) {
        if ( this._activeChosenDirContent ) {
            const deskMenuItems = this._activeChosenDirContent.isDir ? this.DESK_MENU_DIR : this.DESK_MENU_FILE;
            const longestItemLength = Math.max( ...deskMenuItems.map(item => item.length) );

            let deskMenuItemIndex = 0;

            for ( const deskMenuItem of deskMenuItems ) {
                let horizontalBorder = this.COLUMN_CHARACTER.repeat(longestItemLength + 4);
                let horizontalBorderCentered = this._centredDeskMenuItem(horizontalBorder, deskPartLength);

                yield horizontalBorderCentered;

                let innerLeftPaddingCount = (horizontalBorder.length - deskMenuItem.length - 2) / 2;
                let innerRightPaddingCount: number;

                if ( innerLeftPaddingCount % 2 !== 0 ) {
                    innerLeftPaddingCount = Math.ceil(innerLeftPaddingCount);
                }

                innerRightPaddingCount = innerLeftPaddingCount;

                const isDeskMenuItemTarget = this.targetDeskMenuItemIndex === deskMenuItemIndex && this._keydownObserver.targetTerminalSpace === 'deskMenu';
                let deskItemLine = `${this.ROW_CHARACTER}${' '.repeat(innerLeftPaddingCount)}${deskMenuItem}${' '.repeat(innerRightPaddingCount)}${this.ROW_CHARACTER}`;

                deskItemLine = this._centredDeskMenuItem(deskItemLine, deskPartLength, isDeskMenuItemTarget);

                yield deskItemLine;

                yield horizontalBorderCentered;

                deskMenuItemIndex++;
            }
        }

        while(true) {
            let deskMenuLine = '';

            const leftPaddingCount = Math.floor(deskPartLength);
            const leftPadding = ' '.repeat(leftPaddingCount);

            deskMenuLine += leftPadding;

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
    

    private async _handleKeypress(_s: string | undefined, key: Key) {
        if ( key.ctrl && key.name === 'c' ) {
            process.exit();
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

    private _handleUpDir() {
        this.indexTargetContent--;
        this._writeInterface();
    }

    private _handleUpDesk() {
        this.targetDeskMenuItemIndex--;
        this._writeInterface();
    }

    private _handleDownDir() {
        this.indexTargetContent++;
        this._writeInterface();
    }

    private _handleDownDesk() {
        this.targetDeskMenuItemIndex++;
        this._writeInterface();
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

            this._writeInterface();
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

                this._writeInterface();
                break;
            case 'DELETE':

                break;
            case 'OPEN':
                let targetPath = this.chosenDirContentsPath.at(this._indexTargetContent) as string;
                
                await this._openDir(targetPath);

                this._keydownObserver.emit('change', 'workingDir');
                this.targetDeskMenuItemIndex = 0;
                this._activeChosenDirContent = null;

                this._writeInterface();
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