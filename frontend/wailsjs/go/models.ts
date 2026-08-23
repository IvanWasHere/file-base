export namespace archive {
	
	export class CreateRequest {
	    sources: string[];
	    destination: string;
	    format: string;
	    level: number;
	    password: string;
	    splitBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new CreateRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sources = source["sources"];
	        this.destination = source["destination"];
	        this.format = source["format"];
	        this.level = source["level"];
	        this.password = source["password"];
	        this.splitBytes = source["splitBytes"];
	    }
	}
	export class ExtractRequest {
	    path: string;
	    destination: string;
	    password: string;
	    maxBytes: number;
	    maxEntries: number;
	    readOnly: boolean;
	    collapseRoot: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ExtractRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.destination = source["destination"];
	        this.password = source["password"];
	        this.maxBytes = source["maxBytes"];
	        this.maxEntries = source["maxEntries"];
	        this.readOnly = source["readOnly"];
	        this.collapseRoot = source["collapseRoot"];
	    }
	}

}

export namespace db {
	
	export class ExecResult {
	    rowsAffected: number;
	    lastInsertId: number;
	
	    static createFrom(source: any = {}) {
	        return new ExecResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rowsAffected = source["rowsAffected"];
	        this.lastInsertId = source["lastInsertId"];
	    }
	}
	export class Statement {
	    sql: string;
	    args: any[];
	
	    static createFrom(source: any = {}) {
	        return new Statement(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sql = source["sql"];
	        this.args = source["args"];
	    }
	}

}

export namespace filesystem {
	
	export class Tag {
	    name: string;
	    color: number;
	
	    static createFrom(source: any = {}) {
	        return new Tag(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.color = source["color"];
	    }
	}
	export class FileItem {
	    path: string;
	    name: string;
	    size: number;
	    isDirectory: boolean;
	    createdAt: number;
	    modifiedAt: number;
	    permissions: string;
	    hidden: boolean;
	    symlink: boolean;
	    symlinkTarget: string;
	    mimeType: string;
	    broken: boolean;
	    tags: Tag[];
	
	    static createFrom(source: any = {}) {
	        return new FileItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.isDirectory = source["isDirectory"];
	        this.createdAt = source["createdAt"];
	        this.modifiedAt = source["modifiedAt"];
	        this.permissions = source["permissions"];
	        this.hidden = source["hidden"];
	        this.symlink = source["symlink"];
	        this.symlinkTarget = source["symlinkTarget"];
	        this.mimeType = source["mimeType"];
	        this.broken = source["broken"];
	        this.tags = this.convertValues(source["tags"], Tag);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class OpFailure {
	    path: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new OpFailure(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.message = source["message"];
	    }
	}
	export class OpMoved {
	    source: string;
	    target: string;
	
	    static createFrom(source: any = {}) {
	        return new OpMoved(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.source = source["source"];
	        this.target = source["target"];
	    }
	}
	export class OpResult {
	    succeeded: OpMoved[];
	    conflicts: string[];
	    failures: OpFailure[];
	
	    static createFrom(source: any = {}) {
	        return new OpResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.succeeded = this.convertValues(source["succeeded"], OpMoved);
	        this.conflicts = source["conflicts"];
	        this.failures = this.convertValues(source["failures"], OpFailure);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class StandardPaths {
	    home: string;
	    desktop: string;
	    documents: string;
	    downloads: string;
	    applications: string;
	    movies: string;
	    music: string;
	    pictures: string;
	    trash: string;
	    templates: string;
	    themes: string;
	
	    static createFrom(source: any = {}) {
	        return new StandardPaths(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.home = source["home"];
	        this.desktop = source["desktop"];
	        this.documents = source["documents"];
	        this.downloads = source["downloads"];
	        this.applications = source["applications"];
	        this.movies = source["movies"];
	        this.music = source["music"];
	        this.pictures = source["pictures"];
	        this.trash = source["trash"];
	        this.templates = source["templates"];
	        this.themes = source["themes"];
	    }
	}
	
	export class TrashedItem {
	    originalPath: string;
	    trashPath: string;
	
	    static createFrom(source: any = {}) {
	        return new TrashedItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.originalPath = source["originalPath"];
	        this.trashPath = source["trashPath"];
	    }
	}
	export class Volume {
	    name: string;
	    path: string;
	    totalBytes: number;
	    freeBytes: number;
	    removable: boolean;
	    root: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Volume(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.totalBytes = source["totalBytes"];
	        this.freeBytes = source["freeBytes"];
	        this.removable = source["removable"];
	        this.root = source["root"];
	    }
	}

}

export namespace hashing {
	
	export class Request {
	    paths: string[];
	    algorithm: string;
	
	    static createFrom(source: any = {}) {
	        return new Request(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.paths = source["paths"];
	        this.algorithm = source["algorithm"];
	    }
	}

}

export namespace imagemeta {
	
	export class ImageInfo {
	    width: number;
	    height: number;
	    format: string;
	    frames: number;
	    dpiWidth: number;
	    dpiHeight: number;
	    colorModel: string;
	    bitDepth: number;
	    hasAlpha: boolean;
	    indexed: boolean;
	    float: boolean;
	    profileName: string;
	    orientation: number;
	    make: string;
	    model: string;
	    lens: string;
	    software: string;
	    artist: string;
	    copyright: string;
	    description: string;
	    exposureTime: number;
	    fNumber: number;
	    iso: number;
	    focalLength: number;
	    focalLength35: number;
	    exposureBias: number;
	    exposureProgram: number;
	    meteringMode: number;
	    flash: number;
	    whiteBalance: number;
	    colorSpaceTag: number;
	    dateTaken: string;
	    dateTakenUtcOffset: string;
	    hasGps: boolean;
	    latitude: number;
	    longitude: number;
	    altitude: number;
	
	    static createFrom(source: any = {}) {
	        return new ImageInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.width = source["width"];
	        this.height = source["height"];
	        this.format = source["format"];
	        this.frames = source["frames"];
	        this.dpiWidth = source["dpiWidth"];
	        this.dpiHeight = source["dpiHeight"];
	        this.colorModel = source["colorModel"];
	        this.bitDepth = source["bitDepth"];
	        this.hasAlpha = source["hasAlpha"];
	        this.indexed = source["indexed"];
	        this.float = source["float"];
	        this.profileName = source["profileName"];
	        this.orientation = source["orientation"];
	        this.make = source["make"];
	        this.model = source["model"];
	        this.lens = source["lens"];
	        this.software = source["software"];
	        this.artist = source["artist"];
	        this.copyright = source["copyright"];
	        this.description = source["description"];
	        this.exposureTime = source["exposureTime"];
	        this.fNumber = source["fNumber"];
	        this.iso = source["iso"];
	        this.focalLength = source["focalLength"];
	        this.focalLength35 = source["focalLength35"];
	        this.exposureBias = source["exposureBias"];
	        this.exposureProgram = source["exposureProgram"];
	        this.meteringMode = source["meteringMode"];
	        this.flash = source["flash"];
	        this.whiteBalance = source["whiteBalance"];
	        this.colorSpaceTag = source["colorSpaceTag"];
	        this.dateTaken = source["dateTaken"];
	        this.dateTakenUtcOffset = source["dateTakenUtcOffset"];
	        this.hasGps = source["hasGps"];
	        this.latitude = source["latitude"];
	        this.longitude = source["longitude"];
	        this.altitude = source["altitude"];
	    }
	}

}

export namespace search {
	
	export class Criteria {
	    query: string;
	    root: string;
	    extensions: string[];
	    kind: string;
	    minSize: number;
	    maxSize: number;
	    modifiedAfter: number;
	    modifiedBefore: number;
	    includeHidden: boolean;
	    maxResults: number;
	
	    static createFrom(source: any = {}) {
	        return new Criteria(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.query = source["query"];
	        this.root = source["root"];
	        this.extensions = source["extensions"];
	        this.kind = source["kind"];
	        this.minSize = source["minSize"];
	        this.maxSize = source["maxSize"];
	        this.modifiedAfter = source["modifiedAfter"];
	        this.modifiedBefore = source["modifiedBefore"];
	        this.includeHidden = source["includeHidden"];
	        this.maxResults = source["maxResults"];
	    }
	}

}

