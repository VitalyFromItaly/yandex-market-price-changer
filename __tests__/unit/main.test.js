var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { describe, it, afterEach, beforeEach, vi, expect } from 'vitest';
import { Delays, greeter } from '../../src/main.js';
describe('greeter function', () => {
    const name = 'John';
    beforeEach(() => {
        // Read more about fake timers
        // https://vitest.dev/api/vi.html#vi-usefaketimers
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });
    // Assert if setTimeout was called properly
    it('delays the greeting by 2 seconds', () => __awaiter(void 0, void 0, void 0, function* () {
        vi.spyOn(global, 'setTimeout');
        const p = greeter(name);
        yield vi.runAllTimersAsync();
        yield p;
        expect(setTimeout).toHaveBeenCalledTimes(1);
        expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), Delays.Long);
    }));
    // Assert greeter result
    it('greets a user with `Hello, {name}` message', () => __awaiter(void 0, void 0, void 0, function* () {
        const p = greeter(name);
        yield vi.runAllTimersAsync();
        expect(yield p).toBe(`Hello, ${name}`);
    }));
});
