import { stdout, stdin } from "process";
import EventEmitter from "events";
import { Readline } from "readline/promises";
import { normalize, join, parse as pathParse } from "path";
import { TargetTerminalSpace, KeyDownEvents, UpdateInterfaceType } from "./enums";
import { TypeChecker, getAppVariables, rl } from "./functions";

import type { Interface } from "readline/promises";
import type { Key } from "readline";
import type { AnyFunc, DeskMenuEnterHandlersType, KeyDownEventsKeys } from "./types";
import type { IDeskMenuEnterHandler, ITerminalHandlers } from "./interfaces";
import type { WorkingDirWriter, DeskMenuWriter, UpdaterInterface } from "./writers";

const {
    DESK_MENU_DIR,
    DESK_MENU_FILE
} = getAppVariables();

export class KeyDownObserver extends EventEmitter {
    public targetTerminalSpace: TargetTerminalSpace = TargetTerminalSpace.WORKING_DIR;

    constructor() {
        super();

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
            rl.write(null, {
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

    public activate(event: KeyDownEvents, terminalSpace?: TargetTerminalSpace) {
        return super.emit(
            KeyDownEvents[event],
            KeyDownEvents[event] === 'CHANGE' ? terminalSpace : this
        );
    }

    public onDown(workingDirCb: AnyFunc<KeyDownObserver>, deskMenuCb: AnyFunc<KeyDownObserver>) {
        return this._on(KeyDownEvents.DOWN, workingDirCb, deskMenuCb);
    }

    public onUp(workingDirCb: AnyFunc<KeyDownObserver>, deskMenuCb: AnyFunc<KeyDownObserver>) {
        return this._on(KeyDownEvents.UP, workingDirCb, deskMenuCb);
    }

    public onEnter(workingDirCb: AnyFunc<KeyDownObserver>, deskMenuCb: AnyFunc<KeyDownObserver>) {
        return this._on(KeyDownEvents.ENTER, workingDirCb, deskMenuCb);
    }

    public onBackward(cb: AnyFunc) {
        return this._on(KeyDownEvents.BACKWARD, cb);
    }

    public onForward(cb: AnyFunc) {
        return this._on(KeyDownEvents.FORWARD, cb);
    }
}

class KeydownDecorators {
    private static _isCalldown = false;

    public static enterWrapper<TInstance extends object>(target: TInstance, propertyKey: keyof TInstance, descriptor: PropertyDescriptor) {
        if ( !TypeChecker.isFunc(target[propertyKey]) ) {
            throw new TypeError('calldownWrapper decorator apply only functions');
        }

        const readline = new Readline(stdout);

        descriptor.value = new Proxy(target[propertyKey], {
            apply: async (target, thisArg, argArray) => {
                await readline
                    .moveCursor(0, -1)
                    .commit();

                const result = await Reflect.apply(target, thisArg, argArray);

                return result; 
            },
        });
    }

    public static calldownWrapper<TInstance extends object>(target: TInstance, propertyKey: keyof TInstance, descriptor: PropertyDescriptor) {
        if ( !TypeChecker.isFunc(target[propertyKey]) ) {
            throw new TypeError('calldownWrapper decorator apply only functions');
        }

        descriptor.value = new Proxy(target[propertyKey], {
            apply: async (target, thisArg, argArray) => {
                if ( KeydownDecorators._isCalldown ) return;
                KeydownDecorators._isCalldown = true;

                const returnValue = await Reflect.apply(target, thisArg, argArray);

                KeydownDecorators._isCalldown = false;

                return returnValue;
            },
        });
    }

    public static characterWrapper<TInstance extends object>(rl: Interface) {
        return function(target: TInstance, propertyKey: keyof TInstance, descriptor: PropertyDescriptor) {
            if ( !TypeChecker.isFunc(target[propertyKey]) ) {
                throw new TypeError('calldownWrapper decorator apply only functions');
            }
    
            descriptor.value = new Proxy(target[propertyKey], {
                apply: async (target, thisArg, argArray) => {
                    rl.write(null, {
                        ctrl: true,
                        name: 'u'
                    });

                    return (
                        await Reflect.apply(target, thisArg, argArray)
                    )
                },
            });
        }
    }
}

abstract class TerminalHandlers<TInstance> implements ITerminalHandlers {
    protected _context: TInstance;

    constructor(ctx: TInstance) {
        this._context = ctx;
    }

    public abstract up(observer: KeyDownObserver): void;

    public abstract down(observer: KeyDownObserver): void;

    public abstract enter(observer: KeyDownObserver): void;
}

export class WorkingDirHandlers extends TerminalHandlers<WorkingDirWriter> {
    private _updater: UpdaterInterface;

    constructor(ctx: WorkingDirWriter, updater: UpdaterInterface) {
        super(ctx);

        this._updater = updater;
    }

    @KeydownDecorators.calldownWrapper
    public override async up(observer: KeyDownObserver) {
        const oldValue = this._context.indexTargetContent;
        this._context.indexTargetContent--;

        await this._updater.update(observer.targetTerminalSpace, {
            type: UpdateInterfaceType.CHANGE_TARGET_CONTENT,
            value: this._context.indexTargetContent,
            oldValue
        });
    }

    @KeydownDecorators.calldownWrapper
    public override async down(observer: KeyDownObserver) {
        const oldValue = this._context.indexTargetContent;
        this._context.indexTargetContent++;

        await this._updater.update(observer.targetTerminalSpace, {
            type: UpdateInterfaceType.CHANGE_TARGET_CONTENT,
            value: this._context.indexTargetContent,
            oldValue
        });
    }

    @KeydownDecorators.enterWrapper
    public override async enter(observer: KeyDownObserver) {
        const { activeChosenDirContent } = this._context.crossRef;
        const { fileManager, indexTargetContent } = this._context;
        const { chosenDirContentsPath, chosenDir } = fileManager;

        const selectedContent = chosenDirContentsPath.at(indexTargetContent) as string;
        const contentPath = normalize( join(chosenDir, selectedContent) );

        const { ext } = pathParse(contentPath);
        const isDirectory = !ext;

        // Rewrite interface if active content was changed
        if ( activeChosenDirContent?.path !== contentPath ) {
            observer.activate(KeyDownEvents.CHANGE, TargetTerminalSpace.DESK_MENU);
            this._context.crossRef.activeChosenDirContent = {
                path: contentPath,
                isDir: isDirectory
            };

            await this._updater.update(observer.targetTerminalSpace, {
                type: UpdateInterfaceType.CHANGE_TARGET_SPACE
            });
        }
    }

    @KeydownDecorators.characterWrapper(rl)
    public async backward() {
        const { activeChosenDirContent } = this._context.crossRef;
        const { fileManager } = this._context;
        const { contentsRange } = fileManager;

        if ( !TypeChecker.isNull(activeChosenDirContent) ) return;

        if ( TypeChecker.isNull(contentsRange) ) {
            throw new TypeError('contentsRange cannot be a null');
        }

        if ( TypeChecker.isNull(fileManager.contentsEndIndex) ) {
            throw new TypeError('contentsEndIndex cannot be a null');
        }

        fileManager.contentsStartIndex -= contentsRange;
        fileManager.contentsEndIndex -= contentsRange;

        await fileManager.readChosenDir();
        this._updater.writeInterface();
    }

    @KeydownDecorators.characterWrapper(rl)
    public async forward() {
        const { activeChosenDirContent } = this._context.crossRef;
        const { fileManager } = this._context;
        const { contentsRange } = fileManager;

        if ( !TypeChecker.isNull(activeChosenDirContent) ) return;

        if ( TypeChecker.isNull(contentsRange) ) {
            throw new TypeError('contentsRange cannot be a null');
        }

        if ( TypeChecker.isNull(fileManager.contentsEndIndex) ) {
            throw new TypeError('contentsEndIndex cannot be a null');
        }

        fileManager.contentsStartIndex += contentsRange;
        fileManager.contentsEndIndex += contentsRange;

        await fileManager.readChosenDir();
        this._updater.writeInterface();
    }
}

export class DeskMenuHandlers extends TerminalHandlers<DeskMenuWriter> {
    private _updater: UpdaterInterface;
    private _handlers: Map<DeskMenuEnterHandlersType, DeskMenuEnterHandler>;

    constructor(ctx: DeskMenuWriter, updater: UpdaterInterface) {
        super(ctx);

        this._updater = updater;

        const enterHandlers: DeskMenuEnterHandler[] = [
            new DeskMenuBack(this._context, this._updater),
            new DeskMenuOpen(this._context, this._updater),
            new DeskMenuDelete(this._context, this._updater)
        ];

        this._handlers = new Map( enterHandlers.map(handler => [handler.name, handler]) );
    }

    @KeydownDecorators.calldownWrapper
    public override async up(observer: KeyDownObserver) {
        const oldValue = this._context.targetDeskMenuItemIndex;
        this._context.targetDeskMenuItemIndex--;

        await this._updater.update(observer.targetTerminalSpace, {
            type: UpdateInterfaceType.CHANGE_TARGET_CONTENT,
            value: this._context.targetDeskMenuItemIndex,
            oldValue
        });
    }

    @KeydownDecorators.calldownWrapper
    public override async down(observer: KeyDownObserver) {
        const oldValue = this._context.targetDeskMenuItemIndex;
        this._context.targetDeskMenuItemIndex++;

        await this._updater.update(observer.targetTerminalSpace, {
            type: UpdateInterfaceType.CHANGE_TARGET_CONTENT,
            value: this._context.targetDeskMenuItemIndex,
            oldValue
        });
    }

    @KeydownDecorators.enterWrapper
    public override async enter(observer: KeyDownObserver) {
        const { activeChosenDirContent, targetDeskMenuItemIndex } = this._context;

        if ( TypeChecker.isNull(activeChosenDirContent) ) {
            throw new TypeError('There is no active dir content');
        }

        const deskMenu = activeChosenDirContent.isDir ? DESK_MENU_DIR : DESK_MENU_FILE;
        const targetDeskMenuItem = deskMenu.at(targetDeskMenuItemIndex) as DeskMenuEnterHandlersType;
        const handler = this._handlers.get(targetDeskMenuItem);

        if ( handler ) {
            await handler.handle(observer);
        }
    }
}

abstract class DeskMenuEnterHandler implements IDeskMenuEnterHandler {
    protected _context: DeskMenuWriter;
    protected _updater: UpdaterInterface;

    public abstract name: DeskMenuEnterHandlersType;

    constructor(ctx: DeskMenuWriter, updater: UpdaterInterface) {
        this._context = ctx;
        this._updater = updater;
    }

    public abstract handle(observer: KeyDownObserver): Promise<void>;
}

class DeskMenuBack extends DeskMenuEnterHandler {
    public override name: DeskMenuEnterHandlersType = 'BACK';
    
    public override async handle(observer: KeyDownObserver) {
        observer.activate(KeyDownEvents.CHANGE, TargetTerminalSpace.WORKING_DIR);

        this._context.targetDeskMenuItemIndex = 0;
        this._context.activeChosenDirContent = null;

        await this._updater.update(observer.targetTerminalSpace, {
            type: UpdateInterfaceType.CHANGE_TARGET_SPACE
        }); 
    }
}

class DeskMenuDelete extends DeskMenuEnterHandler {
    public override name: DeskMenuEnterHandlersType = 'DELETE';
    
    public override async handle(observer: KeyDownObserver) {
        const { fileManager, indexTargetContent } = this._context.crossRef;
        const { chosenDirContentsPath } = fileManager;

        const path = chosenDirContentsPath.at(indexTargetContent) as string;
        const oldValue = chosenDirContentsPath;

        await fileManager.rm(path);
        this._context.crossRef.setIsNeedToWriteArrows();
        observer.activate(KeyDownEvents.CHANGE, TargetTerminalSpace.WORKING_DIR);

        this._context.targetDeskMenuItemIndex = 0;
        this._context.activeChosenDirContent = null;
        this._context.crossRef.indexTargetContent -= 1;
        
        await this._updater.update(observer.targetTerminalSpace, {
            type: UpdateInterfaceType.REMOVE_CONTENT,
            oldValue
        });
    }
}

class DeskMenuOpen extends DeskMenuEnterHandler {
    public override name: DeskMenuEnterHandlersType = 'OPEN';
    
    public override async handle(observer: KeyDownObserver) {
        const { fileManager, indexTargetContent } = this._context.crossRef;
        const { chosenDirContentsPath } = fileManager;

        const oldValue = chosenDirContentsPath;
        const targetPath = chosenDirContentsPath.at(indexTargetContent) as string;
        
        await fileManager.openDir(targetPath);
        this._context.crossRef.setIsNeedToWriteArrows();
        observer.activate(KeyDownEvents.CHANGE, TargetTerminalSpace.WORKING_DIR);

        this._context.targetDeskMenuItemIndex = 0;
        this._context.crossRef.indexTargetContent = 0;
        this._context.activeChosenDirContent = null;

        await this._updater.update(observer.targetTerminalSpace, {
            type: UpdateInterfaceType.OPEN_DIR,
            oldValue
        });
    }
}