import { Component, OnInit, Input } from '@angular/core';
import { Package, InstallStatusEnum } from '../../core/services/packages.service';
import { DomainService } from '../../core/services/domain.service';
import { faArrowDown, faCoffee  } from '@fortawesome/free-solid-svg-icons';

@Component({
    selector: 'app-package-detailed',
    templateUrl: './package-detailed.component.html',
    styleUrls: ['./package-detailed.component.scss']
})
export class PackageDetailedComponent implements OnInit {
    // faArrowDown = faArrowDown;
    faCoffee = faCoffee;

    @Input() package: Package;
    updatingStatus: string;

    constructor(
        private domainService: DomainService,
    ) { }

    ngOnInit(): void {
    }

    install(): boolean {
        this.domainService.install(this.package);
        return false;
    }

    remove(): boolean {
        this.domainService.remove(this.package);
        return false;
    }

    update(): boolean {
        this.domainService.update(this.package);
        return false;
    }

    getWorkingInfo(): string {
        const p = this.package;
        if (p.state === InstallStatusEnum.downloading) {
            if (p.downloaded) {
                return `${p.downloaded} MB`;
            } else {
                return `0 MB`;
            }
        }
        if (p.state === InstallStatusEnum.extracting) {
            return "Extracting...";
        }
        if (p.state === InstallStatusEnum.installing) {
            return "Installing...";
        }
    }
}
