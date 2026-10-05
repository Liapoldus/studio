export namespace models {

	export class ProductInfo {
	    name: string;
	    description: string;
	    coreAccessModes: string[];
	    singleCoreBinding: boolean;

	    static createFrom(source: any = {}) {
	        return new ProductInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.coreAccessModes = source["coreAccessModes"];
	        this.singleCoreBinding = source["singleCoreBinding"];
	    }
	}

}
