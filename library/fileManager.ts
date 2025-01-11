import { stdout } from "process";
import { resolve, join, normalize, parse as pathParse } from "path";
import { stat, readdir, rm } from "fs/promises";
import { TypeChecker } from "./functions";

import type { IChosenDirContent } from "./interfaces";
import type { Nullable } from "./types";

export class FileManager {
    protected DESK_PART = 1 / 3;
    private UPPER_DIR: IChosenDirContent = {
        path: '../',
        displayPath: '../'
    };

    protected _chosenDirAllPaths: string[] = [ this.UPPER_DIR.path ];
    protected _chosenDirContents: IChosenDirContent[] = [ this.UPPER_DIR ];
    protected _contentsStartIndex = 0;
    protected _contentsEndIndex: Nullable<number> = null;
    protected _contentsRange: Nullable<number> = null;

    public chosenDir: string;

    public get contentsStartIndex() {
        return this._contentsStartIndex;
    }

    public set contentsStartIndex(value: number) {
        if ( value < 0 ) {
            this._contentsStartIndex = 0;
        } else if ( value < this._chosenDirAllPaths.length - 2 ) {
            this._contentsStartIndex = value;
        }
    }

    public get contentsEndIndex() {
        return this._contentsEndIndex;
    }

    public set contentsEndIndex(value: number | null) {
        if ( TypeChecker.isNull(value) ) {
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

    public get chosenDirContentsPath() {
        return this._chosenDirContents.map(content => content.path);
    }

    public get chosenDirContentsInterface() {
        return this._chosenDirContents.map(content => content.displayPath);
    }

    public get chosenDirAllPaths() {
        return this._chosenDirAllPaths;
    }

    public get contentsRange() {
        return this._contentsRange;
    }

    constructor(startDir = '') {
        this.chosenDir = resolve(startDir);
    }

    private async _getChosenDirContent(dirContent: string): Promise<IChosenDirContent> {
        const pathToDirContent = join(this.chosenDir, dirContent);

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
        return normalize( join(this.chosenDir, contentPath) );
    }

    public async readChosenDir() {
        this._chosenDirAllPaths = await readdir(this.chosenDir);

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

    public async openDir(contentPath: string) {
        this.chosenDir = this._getResolvedPath(contentPath);

        await this.readChosenDir();
    }

    public async rm(contentPath: string) {
        const { base } = pathParse(contentPath);
        const regExp = new RegExp(base, 'i');
        this._chosenDirContents = this._chosenDirContents.filter(content => {
            return !regExp.test(content.path);
        });

        contentPath = this._getResolvedPath(contentPath);

        await rm(contentPath, { recursive: true });
    }
}