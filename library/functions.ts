import { stdin, stdout } from "process";
import { createInterface } from "readline/promises";

import type { IChosenDirContent } from "./interfaces";
import type { AnyFunc, Nullable } from "./types";

// Terminal unused space constants
const UNUSED_TERMINAL_ROWS = 7;
const UNUSED_TERMINAL_COLUMNS = 1;

// Terminal interface constants
const PROMPT = '> ';
const ROW_CHARACTER = '|';
const COLUMN_CHARACTER = '-'
const ROW_PADDING = ' '.repeat(2);
const WRITE_MORE_FORWARD = '"f" to -->';
const WRITE_MORE_BACKWARD = '"b" to <--';

// Writing desk menu constants
const DESK_MENU_FILE = ['RENAME', 'DELETE', 'BACK'] as const;
const DESK_MENU_DIR = [...DESK_MENU_FILE, 'OPEN'] as const;
const END_LINE = '\n';

// Other constants
const DESK_PART = 1 / 3;
const UPPER_DIR: IChosenDirContent = { path: '../', displayPath: '../' };

export function getAppVariables() {
    return({
        UNUSED_TERMINAL_ROWS,
        UNUSED_TERMINAL_COLUMNS,
        PROMPT,
        ROW_CHARACTER,
        COLUMN_CHARACTER,
        ROW_PADDING,
        WRITE_MORE_FORWARD,
        WRITE_MORE_BACKWARD,
        DESK_MENU_FILE,
        DESK_MENU_DIR,
        END_LINE,
        DESK_PART,
        UPPER_DIR
    })
}

export const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
    historySize: 0,
    prompt: ''
});

let resizeTimeout: Nullable<NodeJS.Timeout> = null;
const resizeHandlers: Set<AnyFunc> = new Set();

export function addTerminalResizeHandle(callback: AnyFunc) {
    const event = 'SIGWINCH';
    const delay = 100;

    resizeHandlers.add(callback);
    process.on(event, handler);

    function handler() {
        if ( resizeTimeout ) {
            clearTimeout(resizeTimeout);
            resizeTimeout = null;
        }

        resizeTimeout = setTimeout(
            async () => {
                for ( const handle of resizeHandlers ) {
                    await handle();
                }
            },
            delay
        );
    }
}

export class TypeChecker {
    public static isNull(value: unknown): value is null {
        return typeof value === 'object' && !value
    }

    public static isFunc(value: unknown): value is AnyFunc {
        return value instanceof Function
    }

    public static isNumber(value: unknown): value is number {
        return typeof value === 'number';
    }
}