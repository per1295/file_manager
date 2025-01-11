import { stdout } from "process";
import { Readline } from "readline/promises";
import { FileManager } from "./fileManager";
import { WorkingDirWriter, DeskMenuWriter, UpdaterInterface } from "./writers";
import { KeyDownObserver, WorkingDirHandlers, DeskMenuHandlers } from "./keyboad";
import { addTerminalResizeHandle } from "./functions";

export default class FileManagerInterface extends FileManager {
    private _workingDirWriter: WorkingDirWriter;
    private _deskMenuWriter: DeskMenuWriter;
    private _keydownObserver: KeyDownObserver;
    private _updater: UpdaterInterface;

    private _readline = new Readline(stdout);

    constructor(startDir = '') {
        super(startDir);

        this._workingDirWriter = new WorkingDirWriter(this);
        this._deskMenuWriter = new DeskMenuWriter();

        // Set cross refs
        this._workingDirWriter.crossRef = this._deskMenuWriter;
        this._deskMenuWriter.crossRef = this._workingDirWriter;

        this._keydownObserver = new KeyDownObserver();
        this._updater = new UpdaterInterface({
            workingDirWriter: this._workingDirWriter,
            deskMenuWriter: this._deskMenuWriter,
            observer: this._keydownObserver
        });

        const workingDirHandlers = new WorkingDirHandlers(this._workingDirWriter, this._updater);
        const deskMenuHandlers = new DeskMenuHandlers(this._deskMenuWriter, this._updater);

        // Set a resize handler
        addTerminalResizeHandle(async () => {
            this.contentsEndIndex = Math.floor(WorkingDirWriter.terminalSize.numRows / 2) - 2;
            this._contentsRange = this.contentsEndIndex;

            await this._readline
                .cursorTo(0, 0)
                .commit();

            this._updater.writeInterface();
        });
        
        // Set a keydown handlers
        this._keydownObserver.onDown(
            workingDirHandlers.down.bind(workingDirHandlers), deskMenuHandlers.down.bind(deskMenuHandlers)
        );
        this._keydownObserver.onUp(
            workingDirHandlers.up.bind(workingDirHandlers), deskMenuHandlers.up.bind(deskMenuHandlers)
        );
        this._keydownObserver.onEnter(
            workingDirHandlers.enter.bind(workingDirHandlers), deskMenuHandlers.enter.bind(deskMenuHandlers)
        );
        this._keydownObserver.onBackward( workingDirHandlers.backward.bind(workingDirHandlers) );
        this._keydownObserver.onForward( workingDirHandlers.forward.bind(workingDirHandlers) );

        // Initializing a app
        this._initilize();
    }

    private async _initilize() {
        this.contentsEndIndex = Math.floor(WorkingDirWriter.terminalSize.numRows / 2) - 2;
        this._contentsRange = this.contentsEndIndex;

        await this.readChosenDir();
        this._workingDirWriter.setIsNeedToWriteArrows();
        this._updater.writeInterface();
    }
}