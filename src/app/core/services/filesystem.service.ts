import { Injectable } from '@angular/core';
import { Package } from './packages.service';
import { SettingsService } from './settings.service';
import { ElectronService } from './electron/electron.service';
import { BehaviorSubject } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class FilesystemService {
    public folderCopied = new BehaviorSubject<CopyFolderInfo>(null);

    constructor(
        private settingsService: SettingsService,
        private electronService: ElectronService
    ) {

        this.electronService.ipcRenderer.on('copy-folder-success', (event, arg) => {
            if (arg) {
                this.folderCopied.next(arg);
            }
        });

        this.electronService.ipcRenderer.on('log-error', (event, arg) => {
            if (arg) {
                console.error('Node error');
                console.error(arg);
            }
        });

        this.checkCleanUpCommunity();
    }

    private checkCleanUpCommunity() {
        const communityPath = this.settingsService.getSettings().communityPath;
        if (!communityPath) return;

        this.getDirectories(communityPath)
            .then((dirs: string[]) => {
                return dirs.filter(x => x.includes('msfs-downloader___'));
            })
            .then((filDirs: string[]) => {
                for (const d of filDirs) {
                    const fullPath = `${communityPath}\\${d}`;
                    this.deleteFolder(fullPath);
                }
            })
            .catch(err => {
                console.error(err);
            });
    }

    retrievePackageInfo(p: Package): Promise<LocalState> {
        const promise = new Promise<LocalState>((resolve, reject) => {
            try {
                const communityPath = this.settingsService.getSettings().communityPath;
                if (!communityPath) return resolve(new LocalState(false, false, null));

                let path = `${communityPath}\\${p.folderName}`;

                const customPackageFolder = this.settingsService.getCustomPackageDirectory(p.id);
                if (customPackageFolder) {
                    path = `${customPackageFolder}\\${p.folderName}`;
                }

                const folderFound = this.electronService.fs.existsSync(path);

                const versionPath = `${path}\\msfs-downloader-updater.json`;
                const versionFound = this.electronService.fs.existsSync(versionPath);

                let version: string = null;
                if (versionFound) {
                    version = this.electronService.fs.readFileSync(versionPath, 'utf-8');
                }

                const untrackedFolderFound = folderFound && !versionFound;

                resolve(new LocalState(folderFound, untrackedFolderFound, version));
            } catch (error) {
                reject(error);
            }
        });

        return promise;
    }

    getTempDir(): Promise<string> {
        const promise = new Promise<string>((resolve, reject) => {
            try {
                const communityPath = this.settingsService.getSettings().communityPath;

                if (!communityPath) reject(communityPath);

                let tempDir = `${communityPath}\\msfs-downloader___`;
                tempDir = this.electronService.fs.mkdtempSync(tempDir);

                if (this.electronService.fs.existsSync(tempDir)) {
                    this.electronService.fs.rmdirSync(tempDir, { recursive: true });
                }
                this.electronService.fs.mkdirSync(tempDir);
                resolve(tempDir);
            } catch (error) {
                reject(error);
            }
        });
        return promise;
    }

    findAddinFolder(extractedFolder: string): Promise<string> {
        const promise = new Promise<string>((resolve, reject) => {
            (async () => {
                try {
                    const fs = this.electronService.fs;
                    const addinFile = `${extractedFolder}\\manifest.json`;

                    if (!fs.existsSync(extractedFolder)) return resolve(null);
                    if (fs.existsSync(addinFile)) return resolve(extractedFolder);

                    const subDirs = await this.getDirectories(extractedFolder);
                    for (const d of subDirs) {
                        const subDirPath = `${extractedFolder}\\${d}`;
                        const result = await this.findAddinFolder(subDirPath);
                        if (result) return resolve(result);
                    }

                    resolve(null);
                } catch (error) {
                    reject(error);
                }
            })();
        });
        return promise;
    }

    deleteFolder(folderPath: string): Promise<any> {
        const promise = new Promise<any>((resolve, reject) => {
            try {
                if (this.electronService.fs.existsSync(folderPath)) {
                    this.electronService.fs.rmdirSync(folderPath, { recursive: true });
                }
                resolve();
            } catch (error) {
                reject(error);
            }
        });
        return promise;
    }

    copyToCommunity(packageId: string, addinFolderPath: string, packageFolderName: string): void {
        const communityDir = this.settingsService.getSettings().communityPath;
        let target = `${communityDir}\\${packageFolderName}`;

        const customPackageFolder = this.settingsService.getCustomPackageDirectory(packageId);
        if (customPackageFolder) {
            target = `${customPackageFolder}\\${packageFolderName}`;
        }

        const info = new CopyFolderInfo();
        info.packageId = packageId;
        info.source = addinFolderPath;
        info.target = target;

        this.electronService.ipcRenderer.send('copy-folder', info);
    }

    writeVersionFile(targetDir: string, version: string): Promise<any> {
        const promise = new Promise<any>((resolve, reject) => {
            try {
                const path = `${targetDir}\\msfs-downloader-updater.json`;
                this.electronService.fs.writeFileSync(path, version, 'utf-8');
                resolve();
            } catch (error) {
                reject(error);
            }
        });
        return promise;
    }

    private getDirectories(path: string): Promise<string[]> {
        const promise = new Promise<string[]>((resolve, reject) => {
            try {
                const fs = this.electronService.fs;
                const res = fs.readdirSync(path).filter(function (file) {
                    return fs.statSync(path + '/' + file).isDirectory();
                });
                resolve(res);
            } catch (error) {
                reject(error);
            }
        });
        return promise;
    }
}

export class LocalState {
    constructor(
        public folderFound: boolean,
        public untrackedFolderFound: boolean,
        public version: string) { }
}

export class CopyFolderInfo {
    packageId: string;
    source: string;
    target: string;
}