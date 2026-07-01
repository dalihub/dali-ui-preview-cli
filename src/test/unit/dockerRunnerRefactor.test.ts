import { expect } from 'chai';
import * as dr from '../../dockerRunner';

describe('dockerRunner refactor', () => {
  it('exposes renderInContainerAt alongside renderInContainer', () => {
    expect(dr.renderInContainerAt).to.be.a('function');
    expect(dr.renderInContainer).to.be.a('function');
  });
});
