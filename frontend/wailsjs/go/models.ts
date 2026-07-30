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

