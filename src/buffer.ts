const decoder = new TextDecoder();

// smallest backing allocation, so buffers that only ever hold a few bytes
// (most outgoing packets) don't need to reallocate at all after the first write
const MIN_CAPACITY = 32;

export class Buffer {
	// backing storage; may have spare capacity past `end`
	private store: Uint8Array;
	// valid bytes are store[start, end)
	private start: number;
	private end: number;

	static new(): Buffer {
		return new Buffer(new Uint8Array());
	}

	constructor(inner: Uint8Array | number[], copy?: boolean) {
		let arr: Uint8Array;
		if (inner instanceof Uint8Array) {
			arr = copy ? inner.slice() : inner;
		} else {
			arr = Uint8Array.from(inner);
		}
		this.store = arr;
		this.start = 0;
		this.end = arr.length;
	}

	// view of the valid bytes; never includes spare capacity
	get inner(): Uint8Array {
		return this.store.subarray(this.start, this.end);
	}

	copy(): Buffer {
		return new Buffer(this.inner.slice());
	}

	// precious allocations...
	take(cnt: number): Buffer {
		if (this.length < cnt) throw new Error("data too small");

		const ret = this.store.subarray(this.start, this.start + cnt);
		this.start += cnt;
		return new Buffer(ret);
	}

	// grows the backing storage so `extra` more bytes can be appended without
	// reallocating. only ever appends into untouched spare capacity or moves
	// live data into fresh memory - never writes over bytes still referenced
	// by a previously take()n buffer, since those keep pointing at the old
	// (unmodified) backing storage.
	private reserve(extra: number) {
		if (this.store.length - this.end >= extra) return;

		const needed = this.length + extra;
		const newCapacity = Math.max(needed, this.store.length * 2, MIN_CAPACITY);
		const newStore = new Uint8Array(newCapacity);
		newStore.set(this.inner);
		this.store = newStore;
		this.end -= this.start;
		this.start = 0;
	}

	resize(newlen: number) {
		if (newlen > this.length) {
			this.reserve(newlen - this.length);
		}
		this.end = this.start + newlen;
	}

	extend(buf: Buffer) {
		const addLen = buf.length;
		this.reserve(addLen);
		this.store.set(buf.inner, this.end);
		this.end += addLen;
	}

	get(idx: number): number {
		return this.store[this.start + idx];
	}

	toArray(): number[] {
		return Array.from(this.inner);
	}
	toStr(): string {
		return decoder.decode(this.inner);
	}

	get length(): number {
		return this.end - this.start;
	}

	readString(): string {
		const len = this.readVarInt();
		const ret = new TextDecoder().decode(this.take(len).inner);
		return ret;
	}

	writeString(str: string) {
		const data = new TextEncoder().encode(str);
		this.writeVarInt(data.length);
		this.extend(new Buffer(data));
	}

	readUByte(): number {
		const ret = this.get(0);
		this.take(1);
		return ret;
	}

	writeUByte(num: number) {
		this.extend(new Buffer([num & 0xff]));
	}

	readUShort(): number {
		const ret = (this.get(0) << 8) | this.get(1);
		this.take(2);
		return ret;
	}

	writeUShort(num: number) {
		this.extend(new Buffer([num >> 8, num & 0xff]));
	}

	readLong(): number {
		let ret = 0;
		for (let i = 0; i < 8; i++) {
			ret |= this.get(i) << (i * 8);
		}
		this.take(8);
		return ret;
	}

	writeLong(num: number) {
		for (let i = 0; i < 8; i++) {
			this.extend(new Buffer([num & 0xff]));
			num >>= 8;
		}
	}

	// you can probably make this better
	readVarInt(take: boolean = true): number {
		let index = 0;
		let result = 0;
		let shift = 0;
		let byte: number;

		do {
			if (index >= this.length) {
				throw new Error("data too small");
			}
			byte = this.get(index++);
			result |= (byte & 127) << shift;
			shift += 7;
		} while (byte >= 128);

		if (take) this.take(index);
		return result;
	}

	readVariableData(): Buffer {
		const len = this.readVarInt();
		if (!len) throw new Error("data too small");
		return this.take(len);
	}

	writeVarInt(num: number) {
		const buffer: number[] = [];
		while (num > 127) {
			buffer.push((num & 127) | 128);
			num >>>= 7;
		}
		buffer.push(num);
		this.extend(new Buffer(buffer));
	}

	writeVariableData(data: Buffer) {
		this.writeVarInt(data.length);
		this.extend(data);
	}

	writeBytes(data: number[]) {
		this.extend(new Buffer(data));
	}
}
