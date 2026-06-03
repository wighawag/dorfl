import {it, describe, expect} from 'vitest';
import {hello} from '../src/index.js';

describe('hello test', () => {
	it('return Hello World', () => {
		expect(hello()).toEqual('Hello World!');
	});
});
