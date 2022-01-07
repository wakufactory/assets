/** 
	* tile map image loader
	*/

class Maptile {
/**
	* @constructor
	* @param {Object} size canvas size
	* @param {String} path tile map image path
	* @param {Object} opt  options
	*/
constructor(can,path,opt) {
	this.opt = {bgcolor:"rgba(190,210,255,1)",
		loadingcolor:"rgba(0,0,0,1)",maxzoom:18 }
	for(let o in opt) this.opt[o] = opt[o] 
	this.mappath = path
	if(can.constructor==HTMLCanvasElement) {
		this.can = can 
		this.size = {width:this.can.width,height:this.can.height}
	} else {
		this.size = can 
		this.can = document.createElement('canvas') ;
		this.can.width = can.width ; this.can.height = can.height ;
	}
	this.ctx = this.can.getContext("2d") ;
	this.ctx.fillStyle = this.opt.loadingcolor  ;
	this.ctx.fillRect(0,0,this.can.width,this.can.height) ;
	this.tile = {width:256,height:256}
	this.hwx = this.size.width/this.tile.width/2
	this.hwy = this.size.height/this.tile.height/2
	this.tcache = {}
	this.tcount = 0 
	this.tcmin = 0 
	this.pzoom = 0 
	this.ptile = {x:0,y:0}
	this.proceed = false 
	this.canf = false 
	this.pofs = {x:0,y:0}
	if(opt.useWorker) this.worker = new Worker('js/loaddata_worker.js')
}
/**
	* fetch image 
	* @param {String} src
	* @return {Promise}
	*/
loadImageAjax(src) {
	return new Promise((resolve,reject)=> {
		let req = new XMLHttpRequest();
		req.open("get",src,true) ;
		req.responseType = "blob" ;
		req.onload = function() {
			if(this.status==200) {
				let timg = new Image
				const url = URL.createObjectURL(this.response);
				timg.onload = function() {
					URL.revokeObjectURL(url)
					resolve(timg)
				}
				timg.src = url
			} else {
				resolve(null) ;					
			}
		}
		req.onerror = function() {
			resolve(null)
		}
		try {
			req.send()
		} catch(err) { console.log(err) }
	})
}

cancel() {
//	console.log("setcancel")
	this.canf = true 
}


/**
	* get tile from cache
	* @param {Int} zoom
	* @param {Object} tile
	* @return {Image} or {Canvas}
	*/
tilecache(zoom,tile) {
		let txi = Math.floor(tile.x) 
		let tyi = Math.floor(tile.y)
		const tid = `${zoom}-${txi}-${tyi}`
		if(this.tcache[tid]!== undefined ) {
//			console.log("cached:"+tid)
			return this.tcache[tid].img 
		} else return null
}
addcache(zoom,tile,img) {
		let txi = Math.floor(tile.x) 
		let tyi = Math.floor(tile.y)
		this.tcache[`${zoom}-${txi}-${tyi}`] = {img:img,count:this.tcount++} 
}
clearcache() {
	this.tcache = {}
	this.tcount = 0
	this.tcmin = 0 
}
gccache(lim) {
	let keys = Object.keys(this.tcache)
	if(keys.length<lim) return
	this.tcmin = this.tcount - lim 
	let pc = 0 
	for( let k of keys) {
		if(this.tcache[k].count<this.tcmin) {
			delete this.tcache[k]
			pc++
		}
	}
	console.log("cache parged:"+pc)
}
/**
	* get tile image 
	* @param {Int} zoom
	* @param {Object} tile tile axis
	* @return {Promise}
	*/
async getTile(zoom,tile,st) {

	let z = zoom 
	let txi = Math.floor(tile.x) 
	let tyi = Math.floor(tile.y)
	let zf = 1 
	if(zoom>this.opt.maxzoom) {
		zf = 2 ** (z-this.opt.maxzoom) 
		z = this.opt.maxzoom
		txi = Math.floor(txi/zf)
		tyi = Math.floor(tyi/zf)
	}
	const tid = `${zoom}-${txi}-${tyi}`	
	const path = this.mappath.replace("{z}",z).replace("{x}",txi).replace("{y}",tyi)
	
	return new Promise(async (resolve,reject)=>{
		let img 
		if(this.opt.gettile) img = await this.opt.gettile({x:txi,y:tyi,z:z})
		else {
			if(this.opt.useWorker) {
				const data = await this.loadImageWorker(path,st)
				if(data.st!=st) {
					console.log("over")
					resolve({img:null})
				}
				img = data.img
			} 
			else img = await this.loadImageAjax(path)
			if(img==null) resolve(null)
//			console.log(`tile loaded ${zoom} ${txi} ${tyi}`)
			if(zoom>this.opt.maxzoom) {
				const can = document.createElement('canvas')
				can.width = this.tile.width
				can.height = this.tile.height
				const ctx = can.getContext("2d")
				ctx.imageSmoothingEnabled = false 	
				let dx = (tile.x - txi*zf)*can.width/zf
				let dy = (tile.y - tyi*zf)*can.height/zf
				ctx.drawImage(img,dx,dy,img.width/zf,img.height/zf,0,0,can.width,can.height)
				img = can 
			}
		}
		this.addcache(zoom,tile,img) 
		resolve({img:img,st:st}) 
//		console.log(`tile ${zoom}-${txi}-${tyi}`)
	})
}
async loadImageWorker(path,st) {
	return new Promise(async (resolve,reject)=>{
		//recive message
		this.worker.onmessage = e=> {
//			console.log(e.data)
			if(e.data==null) resolve(null) 
			blob2img(e.data).then(img=>{
				resolve({img:img,st:st}) 		
			})
		}
		this.worker.postMessage({path:path,type:"blob"})
	})
	function blob2img(blob) {
		return new Promise(function(resolve,reject) {
			let timg = new Image ;
			timg.onload = function() {
				resolve (timg)
			}
			timg.src = URL.createObjectURL(blob);	
		})
	}	
}
/**
	* get map tile canvas
	* @param {Int} zoom
	* @param {Object} latlng
	* @return {Promise}
	*/

getMap(zoom,latlng,update=true,load=true,dlat=1,dlng=1) {
//	console.log(`getmap ${zoom} ${latlng.lat} ${latlng.lng} ${this.mappath}`)
	this.st = new Date().getTime() 
	return new Promise(async (resolve,reject)=>{
		if(this.pzoom!=zoom) {
			this.clearcache()
			this.pzoom = zoom 
		}
		let tn = Maptile.latlng2tile(zoom,latlng)
		let tilex = Math.floor(tn.x)
		let tiley = Math.floor(tn.y)
		let tofsx = tn.x -tilex
		let tofsy = tn.y -tiley 
		let tsx = Math.floor(tn.x - this.hwx)
		let tex = Math.floor(tn.x + this.hwx)
		let tsy = Math.floor(tn.y - this.hwy)
		let tey = Math.floor(tn.y + this.hwy)
		let ofsx = Math.floor(-tn.x*this.tile.width + this.size.width/2) 
		let ofsy = Math.floor(-tn.y*this.tile.height + this.size.height/2)
		this.tilearea = {sx:tn.x - this.hwx,sy:tn.y - this.hwy,ex:tn.x + this.hwx,ey:tn.y + this.hwy}

		const roll= async (ox,oy)=> {
				const px = ofsx+ox*this.tile.width
				const py = ofsy+oy*this.tile.height	
				if(px < -this.tile.width || px >= this.size.width || py < -this.tile.height || py >= this.size.height ) {
					console.log(`skip ${px}x${py}`) 
					return  
				}
				let img = this.tilecache(zoom,{x:ox,y:oy})
				if(img===null && load) {
					img = await this.getTile(zoom,{x:ox,y:oy},this.st)
//					console.log(`newimg ${zoom} ${ox},${oy}`)
					if(img!==null) {
						
						if(img.st != this.st) {
							console.log(img)
							console.log(this.st)
							console.log(`canceled ${zoom} ${ox}-${oy}`)
							return false
						}
						img = img.img 
					}
				} else {
//					console.log(`hit cache ${zoom} ${ox} ${oy}`)
				}
				if(img!==null) {

					this.ctx.fillStyle = this.opt.bgcolor 
					this.ctx.fillRect(px,py,this.tile.width,this.tile.height);	
					this.ctx.drawImage(img,px,py,this.tile.width,this.tile.height);	
					if(this.onupdate && update) {
						this.onupdate(this.updateblock(img.img,px,py))
					}
				} else {
					this.ctx.fillStyle = this.opt.bgcolor   
					this.ctx.fillRect(px,py,this.tile.width,this.tile.height);	
				}
//				console.log(`draw ${ox}x${oy}`) 
				return true 
		}
		const sync = []
		this.canf = false 
		for(let oy=(dlat>=0?tsy:tey); (dlat>=0)?oy<=tey:oy>=tsy; oy+=dlat) {
			for(let ox=(dlng>0?tsx:tex); (dlng>0)?ox<=tex:ox>=tsx; ox+=dlng) {
				if(this.canf) {
					this.canf = false 
					console.log(" f canceled")
					resolve(false)
					retrun 
				}
//				sync.push(roll(ox,oy))
//				console.log(`await ${zoom} ${ox} ${oy}`)
				if(!await roll(ox,oy)) return
			}
		}
		this.ptile = tn
		resolve(true)
//		Promise.all(sync).then(v=>{resolve(true)})	
	})
}
updateblock(img,ofsx,ofsy) {
		let wx = this.tile.width
		let wy = this.tile.height
		let ox = ofsx 
		let oy = ofsy 
		let f = false 
		if( ofsx < 0) {
			ox = 0
			wx = this.tile.width+ofsx
			ofsx = 0 
			f = true 
		}
		if(ofsy < 0) {
			oy = 0
			wy = this.tile.height+ofsy
			ofsy = 0 
			f = true 
		}
		if( ofsx + wx > this.can.width)  {
			wx = this.can.width - ofsx 
			f = true 
		}
		if( ofsy + wy > this.can.height) { 
			wy = this.can.height - ofsy
			f = true 
		}
//	console.log(ox,oy,wx,wy)	
		if(wx!=0&&wy!=0)	
			img = (f)? this.ctx.getImageData(ox,oy,wx,wy) : img 
		return {img:img,ofsx:ofsx,ofsy:ofsy} 
}
/**
	* scroll to latlng 
	* @param {Object} latlng
	* @return {Promise}
	*/
	
scrollTo(latlng,load=true) {
	return new Promise(async (resolve,reject)=>{
		let zoom = this.pzoom 
		let tn = Maptile.latlng2tile(zoom,latlng)
		let diffx = tn.x - this.ptile.x 
		let diffy = tn.y - this.ptile.y 
		let zf =  diffx > this.hwx || diffy > this.hwy
		this.getMap(zoom,latlng,false,load,diffy>0?1:-1,diffx>0?1:-1).then(f=> {
			resolve(true)
		} )

		let tilex = Math.floor(tn.x)
		let tiley = Math.floor(tn.y)
		let tofsx = tn.x -tilex 
		let tofsy = tn.y -tiley 
	})	
}
zoomcanvas(ratio) {
	if(ratio==1 || ratio==0) return 
	let ra = (ratio<1)?ratio:1/ratio 
	let pw = this.size.width * ra 
	let ph = this.size.height * ra
	let ow = (this.size.width - pw)/2 
	let oh = (this.size.height - ph)/2 
	if(ratio>1) {
		this.ctx.drawImage(this.can,ow,oh,pw,ph,0,0,this.size.width,this.size.height)
	} else {
		this.ctx.drawImage(this.can,0,0,this.size.width,this.size.height,ow,oh,pw,ph)	
		this.ctx.fillStyle = this.opt.loadingcolor 
		this.ctx.fillRect(0,0,this.size.width,oh)
		this.ctx.fillRect(0,ph+oh,this.size.width,oh)
		this.ctx.fillRect(0,oh,ow,ph)
		this.ctx.fillRect(pw+ow,oh,ow,ph)
	}
}
getCanvas(latlng) {
	let tn = Maptile.latlng2tile(this.pzoom,latlng)
	const ta = this.tilearea
	if(ta.sx>tn.x || ta.ex<tn.x || ta.sy>tn.y || ta.ey<tn.y) return null
	let px = (tn.x-ta.sx)/(this.hwx*2)*this.can.width 
	let py = (tn.y-ta.sy)/(this.hwy*2)*this.can.height 
	let img = this.ctx.getImageData(px,py,1,1)
	return {px:px,py:py,data:img.data}
}
}//class Maptile
// static methods
/**
	* convert lat-lng to tile axis
	* @param {Int} z  tile zoom
	* @param {Object} latlng
	*/
Maptile.latlng2tile = function(z,latlng) {
	let d = Math.pow(2,z) ;
	let x = (180+latlng.lng)/360 ;
	let siny = Math.min(Math.max(Math.sin(latlng.lat* (Math.PI / 180)), -.9999),.9999);
	let y = (0.5 - 0.5 * Math.log((1 + siny) / (1 - siny)) / (2 * Math.PI))
	return {x:x*d,y:y*d} ;
}
/**
	* convert tile axis to lat-lng
	* @param {Int} z
	* @param {Object} tile
	*/
Maptile.tile2latlng = function(z,tile) {
	let d = Math.pow(2,z) ;
	let x = tile.x/d ;
	let y = tile.y/d ;		
	let lat= (2 * Math.atan(
			Math.exp( (y - 0.5) * -(2 * Math.PI))
		) - Math.PI / 2)/ (Math.PI / 180)
	let lng =  (x - 0.5) * 360
	return {lat:lat,lng:lng} ;
}
Maptile.latlng2length = function(latlng) {
	const r = 6356752
	const er = 2*Math.PI*r/360
	return {lng: Math.cos(latlng.lat / 180 * Math.PI) * er, lat:er}
}