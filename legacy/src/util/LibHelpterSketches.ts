// static copy<T = unknown>(source: T, destination?: Dictionary | unknown[], maxDepth?: number): T {
//   const stackSource: unknown[] = [];
//   const stackDest: unknown[] = [];
//   maxDepth = maxDepth && maxDepth > 0 ? maxDepth : NaN;
//
//   if (destination) {
//     if (LibHelper.isTypedArray(destination) || LibHelper.isArrayBuffer(destination)) {
//       throw Error("Can't copy! TypedArray destination cannot be mutated.");
//     }
//     if (source === destination) {
//       throw Error("Can't copy! Source and destination are identical.");
//     }
//
//     // Empty the destination object
//     if (LibHelper.isArray(destination)) {
//       destination.length = 0;
//     } else {
//       LibHelper.forEach(destination, function (value, key) {
//         if (key !== '$$hashKey') {
//           delete (destination as Dictionary)[key];
//         }
//       });
//     }
//
//     stackSource.push(source);
//     stackDest.push(destination);
//     return copyRecurse(source, destination, maxDepth);
//   }
//
//   return copyElement(source, maxDepth);
//
//   function copyRecurse(source: T, destination: unknown, maxDepth: number) {
//     maxDepth--;
//     if (maxDepth < 0) {
//       return '...';
//     }
//     const h: unknown = (destination as Dictionary).$$hashKey;
//     if (LibHelper.isArray(source)) {
//       for (let i = 0,
//         ii = (source as unknown as unknown[]).length; i < ii; i++) {
//         // @ts-ignore
//         (destination as unknown[]).push(copyElement(source[i], maxDepth));
//       }
//     } else if (LibHelper.isBlankObject(source)) {
//       // createMap() fast path --- Safe to avoid hasOwnProperty check because prototype chain is empty
//       for (const key in source as Dictionary) {
//         // @ts-ignore
//         (destination as Dictionary)[key] = copyElement(source[key], maxDepth);
//       }
//     } else if (source && typeof source.hasOwnProperty === 'function') {
//       // Slow path, which must rely on hasOwnProperty
//       for (const key in source as Dictionary) {
//         if (source.hasOwnProperty(key)) {
//           (destination as Dictionary)[key] = copyElement(  source[key], maxDepth);
//         }
//       }
//     } else {
//       // Slowest path --- hasOwnProperty can't be called as a method
//       for (const key in source as Dictionary) {
//         if (Object.hasOwnProperty.call(source, key)) {
//           // @ts-ignore
//           (destination as Dictionary)[key] = copyElement((source as Dictionary)[key], maxDepth);
//         }
//       }
//     }
//     LibHelper.setHashKey(destination as Dictionary, h);
//     return destination;
//   }
//
//   function copyElement(source: T, maxDepth: number) {
//     // Simple values
//     if (!LibHelper.isObject(source)) {
//       return source;
//     }
//
//     // Already copied values
//     const index = stackSource.indexOf(source);
//     if (index !== -1) {
//       return stackDest[index];
//     }
//
//     if (LibHelper.isWindow(source) || LibHelper.isWindow(source)) {
//       throw Error("Can't copy! Making copies of Window or Scope instances is not supported.");
//     }
//
//     let needsRecurse = false;
//     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//     // @ts-ignore
//     let destination = copyType(source);
//
//     if (destination === undefined) {
//       destination = LibHelper.isArray(source) ? [] : Object.create(Object.getPrototypeOf(source));
//       needsRecurse = true;
//     }
//
//     stackSource.push(source);
//     stackDest.push(destination);
//
//     return needsRecurse ? copyRecurse(source, destination, maxDepth) : destination;
//   }
//
//   function copyType(source: T): unknown {
//     switch (toString.call(source)) {
//       case '[object Int8Array]':
//       case '[object Int16Array]':
//       case '[object Int32Array]':
//       case '[object Float32Array]':
//       case '[object Float64Array]':
//       case '[object Uint8Array]':
//       case '[object Uint8ClampedArray]':
//       case '[object Uint16Array]':
//       case '[object Uint32Array]':
//         // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//         // @ts-ignore
//         return new source.constructor(copyElement(source.buffer), source.byteOffset, source.length);
//
//       case '[object ArrayBuffer]':
//         // Support: IE10
//         // @ts-ignore
//         if (!source.slice) {
//           // If we're in this case we know the environment supports ArrayBuffer
//           /* eslint-disable no-undef */
//           const copied = new ArrayBuffer((source as unknown as ArrayBuffer).byteLength);
//           // @ts-ignore
//           new Uint8Array(copied).set(new Uint8Array(source));
//           /* eslint-enable */
//           return copied;
//         }
//         // @ts-ignore
//         return source.slice(0);
//
//       case '[object Boolean]':
//       case '[object Number]':
//       case '[object String]':
//       case '[object Date]':
//         // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//         // @ts-ignore
//         return new source.constructor(source.valueOf());
//
//       case '[object RegExp]':
//         // @ts-ignore
//         const re = new RegExp(source.source, source.toString().match(/[^/]*$/)[0]);
//         // @ts-ignore
//         re.lastIndex = source.lastIndex;
//         return re;
//
//       case '[object Blob]':
//         // eslint-disable-next-line @typescript-eslint/ban-ts-comment
//         // @ts-ignore
//         return new source.constructor([source], { type: (source as Blob).type });
//     }
//
//     // @ts-ignore
//     if (LibHelper.isFunction(source.cloneNode)) {
//       // @ts-ignore
//       return source.cloneNode(true);
//     }
//   }
// }
