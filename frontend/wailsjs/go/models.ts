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

