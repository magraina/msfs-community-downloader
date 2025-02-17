import { Injectable, ApplicationRef } from '@angular/core';
import { FilesystemService, LocalState, CopyFolderInfo } from './filesystem.service';
import { GithubService, PackageInfo } from './github.service';
import { Package, InstallStatusEnum, PackagesService } from './packages.service';
import { DownloaderService, FileDownloadInfo, FileDownloadUpdate } from './downloader.service';
import { Subscription } from 'rxjs';
import { ExtractorService, FileExtractedInfo } from './extractor.service';
import { SettingsService } from './settings.service';

@Injectable({
    providedIn: 'root'
})
export class DomainService {
    private packages: Package[];
    private downloadSub: Subscription;
    private downloadUpdateSub: Subscription;
    private extractSub: Subscription;
    private copySub: Subscription;

    constructor(
        private app: ApplicationRef,
        private packageService: PackagesService,
        private filesystemService: FilesystemService,
        private githubService: GithubService,
        private downloaderService: DownloaderService,
        private extractorService: ExtractorService,
        private settingsService: SettingsService
    ) {
        this.downloadSub = downloaderService.fileDownloaded.subscribe(r => {
            if (r) {
                this.processDownloadedFile(r);
            }
        });
        this.downloadUpdateSub = downloaderService.fileDownloadedUpdated.subscribe(r => {
            if (r) {
                this.processDownloadedUpdate(r);
            }
        });
        this.extractSub = extractorService.fileExtracted.subscribe(r => {
            if (r) {
                this.processExtractedFolder(r);
            }
        });
        this.copySub = filesystemService.folderCopied.subscribe(r => {
            if (r) {
                this.processCopiedFolder(r);
            }
        });
    }

    analysePackages(packages: Package[]): Promise<any> {
        let error: any = null;
        let pipeline: Promise<any> = Promise.resolve(true);
        packages.forEach(x => {
            pipeline = pipeline.then(() => {
                return this.analysePackage(x)
                    .catch(err => {
                        console.error(err);
                        error = err;
                        x.state = InstallStatusEnum.error;
                    });
            });
        });
        pipeline = pipeline.then(() => {
            if (error) {
                throw (error);
            }
        });
        return pipeline;
    }

    private analysePackage(p: Package): Promise<any> {
        const localPromise = this.filesystemService.retrievePackageInfo(p);
        const githubPromise = this.githubService.retrievePackageInfo(p);

        return Promise.all([localPromise, githubPromise])
            .then(result => {
                const local = result[0];
                const remote = result[1];

                if (local) {
                    p.localVersion = local.version;
                }

                if (remote) {
                    p.availableVersion = remote.availableVersion;
                    p.assetDownloadUrl = remote.downloadUrl;
                    p.publishedAt = remote.publishedAt;
                    p.html_url = remote.html_url;
                }

                p.state = this.getState(p, local, remote);
            });
    }

    private getState(p: Package, local: LocalState, info: PackageInfo): InstallStatusEnum {
        if (p.state === InstallStatusEnum.downloading) return InstallStatusEnum.downloading;
        if (p.state === InstallStatusEnum.extracting) return InstallStatusEnum.extracting;
        if (p.state === InstallStatusEnum.installing) return InstallStatusEnum.installing;

        if (local && local.untrackedFolderFound) return InstallStatusEnum.untrackedPackageFound;
        if (local && !local.folderFound) return InstallStatusEnum.notFound;
        if (local && local.version && info && info.availableVersion) {
            if (local.version === info.availableVersion) return InstallStatusEnum.installed;
            if (local.version !== info.availableVersion) return InstallStatusEnum.updateAvailable;
        }

        if (p.state === InstallStatusEnum.error) return InstallStatusEnum.error;
        return InstallStatusEnum.unknown;
    }

    private processDownloadedFile(r: FileDownloadInfo): void {
        const downloadedPackage = this.packages.find(x => x.id === r.packageId);
        downloadedPackage.state = InstallStatusEnum.extracting;
        downloadedPackage.downloaded = null;
        this.app.tick();

        this.extractorService.extract(downloadedPackage.id, r.filePath);
    }

    processDownloadedUpdate(r: FileDownloadUpdate): void {
        const downloadedPackage = this.packages.find(x => x.id === r.packageId);
        downloadedPackage.downloaded = r.downloadedData;
        this.app.tick();
    }

    async processExtractedFolder(r: FileExtractedInfo): Promise<any> {
        try {
            const extractedFolder = r.extractFolder;
            const addinFolderPath = await this.filesystemService.findAddinFolder(extractedFolder);

            if (!addinFolderPath) return;

            const p = this.packages.find(x => x.id === r.packageId);

            const communityDir = this.settingsService.getSettings().communityPath;
            const folderPath = `${communityDir}\\${p.folderName}`;

            p.state = InstallStatusEnum.installing;
            this.app.tick();

            // Clean up
            await this.filesystemService.deleteFolder(folderPath);

            if (p.oldFolderNames && p.oldFolderNames.length > 0) {
                p.oldFolderNames.forEach(o => {
                    (async () => {
                        const oldFolderPath = `${communityDir}\\${o}`;
                        await this.filesystemService.deleteFolder(oldFolderPath);
                    })();
                });
            }

            this.filesystemService.copyToCommunity(p.id, addinFolderPath, p.folderName);
        } catch (err) {
            console.error(err);
        }
    }

    processCopiedFolder(r: CopyFolderInfo): void {
        try {
            const p = this.packages.find(x => x.id === r.packageId);
            if (p.tempWorkingDir) {
                this.filesystemService.deleteFolder(p.tempWorkingDir);
                p.tempWorkingDir = null;
            }
            this.filesystemService.writeVersionFile(r.target, p.availableVersion);
            p.localVersion = p.availableVersion;
            p.state = InstallStatusEnum.installed;
            this.app.tick();
        } catch (err) {
            console.error(err);
        }
    }

    getPackages(): Package[] {
        if (this.packages) {
            return this.packages;
        }

        this.packages = this.packageService.getPackages();
        return this.packages;
    }

    addCustomPackage(p: Package): void {
        if (!this.packages) {
            this.getPackages();
        }

        if (!p) return;
        p.minSoftwareVersion = this.settingsService.getVersion();

        this.packages.forEach(x => x.isSelected = false);

        const settings = this.settingsService.getSettings();
        settings.customPackages.push(p);
        this.settingsService.saveSettings(settings);

        this.packages.unshift(p);
        p.state = InstallStatusEnum.unknown;
        p.isCustomPackage = true;
        p.isSelected = true;
        this.analysePackage(p)
            .catch(err => {
                console.error(err);
            });
    }

    addOnlinePackage(p: Package): void {
        if (!this.packages) {
            this.getPackages();
        }

        if (!p) return;

        this.packages.forEach(x => x.isSelected = false);

        const settings = this.settingsService.getSettings();
        settings.onlinePackages.push(p);
        this.settingsService.saveSettings(settings);

        this.packages.unshift(p);
        p.state = InstallStatusEnum.unknown;
        p.isOnlinePackage = true;
        p.isSelected = true;

        this.analysePackage(p)
            .catch(err => {
                console.error(err);
            });
    }

    updateCustomPackage(p: Package): void {
        if (!p) return;

        const settings = this.settingsService.getSettings();
        const toUpdate = settings.customPackages.find(x => x.id === p.id);

        toUpdate.id = p.id;
        toUpdate.name = p.name;
        toUpdate.description = p.description;
        toUpdate.summary = p.summary;
        toUpdate.githubOwner = p.githubOwner;
        toUpdate.githubRepo = p.githubRepo;
        toUpdate.assetName = p.assetName;
        toUpdate.isPrerelease = p.isPrerelease;
        toUpdate.folderName = p.folderName;
        toUpdate.illustration = p.illustration;
        toUpdate.webpageUrl = p.webpageUrl;
        toUpdate.versionPatternToRemove = p.versionPatternToRemove;

        this.settingsService.saveSettings(settings);

        const localToUpdate = this.packages.find(x => x.id === p.id);

        localToUpdate.id = p.id;
        localToUpdate.name = p.name;
        localToUpdate.description = p.description;
        localToUpdate.summary = p.summary;
        localToUpdate.githubOwner = p.githubOwner;
        localToUpdate.githubRepo = p.githubRepo;
        localToUpdate.assetName = p.assetName;
        localToUpdate.isPrerelease = p.isPrerelease;
        localToUpdate.folderName = p.folderName;
        localToUpdate.illustration = p.illustration;
        localToUpdate.webpageUrl = p.webpageUrl;
        localToUpdate.versionPatternToRemove = p.versionPatternToRemove;
    }

    updateOnlinePackage(p: Package): void {
        if (!p) return;

        const settings = this.settingsService.getSettings();
        const toUpdate = settings.onlinePackages.find(x => x.id === p.id);

        toUpdate.id = p.id;
        toUpdate.name = p.name;
        toUpdate.description = p.description;
        toUpdate.summary = p.summary;
        toUpdate.githubOwner = p.githubOwner;
        toUpdate.githubRepo = p.githubRepo;
        toUpdate.assetName = p.assetName;
        toUpdate.isPrerelease = p.isPrerelease;
        toUpdate.folderName = p.folderName;
        toUpdate.illustration = p.illustration;
        toUpdate.webpageUrl = p.webpageUrl;
        toUpdate.versionPatternToRemove = p.versionPatternToRemove;
        toUpdate.onlineVersion = p.onlineVersion;

        this.settingsService.saveSettings(settings);

        const localToUpdate = this.packages.find(x => x.id === p.id);

        localToUpdate.id = p.id;
        localToUpdate.name = p.name;
        localToUpdate.description = p.description;
        localToUpdate.summary = p.summary;
        localToUpdate.githubOwner = p.githubOwner;
        localToUpdate.githubRepo = p.githubRepo;
        localToUpdate.assetName = p.assetName;
        localToUpdate.isPrerelease = p.isPrerelease;
        localToUpdate.folderName = p.folderName;
        localToUpdate.illustration = p.illustration;
        localToUpdate.webpageUrl = p.webpageUrl;
        localToUpdate.versionPatternToRemove = p.versionPatternToRemove;
        localToUpdate.onlineVersion = p.onlineVersion;
    }

    removeCustomPackage(p: Package): void {
        if (!p) return;

        const settings = this.settingsService.getSettings();
        settings.customPackages = settings.customPackages.filter(x => x.id !== p.id);
        this.settingsService.saveSettings(settings);

        this.packages = this.packages.filter(x => x.id !== p.id);
    }

    removeOnlinePackage(p: Package): void {
        if (!p) return;

        const settings = this.settingsService.getSettings();
        settings.onlinePackages = settings.onlinePackages.filter(x => x.id !== p.id);
        this.settingsService.saveSettings(settings);

        this.packages = this.packages.filter(x => x.id !== p.id);
    }

    install(p: Package): void {
        // const p = this.packages.find(x => x.id === pack.id);

        p.state = InstallStatusEnum.downloading;
        this.app.tick();
        this.filesystemService.getTempDir()
            .then(tempDir => {
                p.tempWorkingDir = tempDir;
                this.downloaderService.download(p.id, p.assetDownloadUrl, tempDir);
            });
    }

    update(p: Package): void {
        this.install(p);
    }

    remove(p: Package): void {
        const communityDir = this.settingsService.getSettings().communityPath;

        let folderPath = `${communityDir}\\${p.folderName}`;

        const customPackageFolder = this.settingsService.getCustomPackageDirectory(p.id);
        if (customPackageFolder) {
            folderPath = `${customPackageFolder}\\${p.folderName}`;
        }

        this.filesystemService.deleteFolder(folderPath)
            .then(() => {
                p.localVersion = null;
                p.state = InstallStatusEnum.notFound;
                this.app.tick();
            })
            .catch(err => {
                console.error(err);
            });
    }
}
