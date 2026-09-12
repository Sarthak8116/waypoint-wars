import { describe, expect, it } from 'vitest';
import { isUnsuitable } from './places.js';

/**
 * The generator points strangers at a building and asks them to photograph it.
 * These are the places where doing that gets someone questioned by security,
 * or is simply wrong. Found live: a Savannah hunt chose a U.S. Customs and
 * Border Protection facility as the finish every player converges on.
 */
describe('isUnsuitable', () => {
  it('rejects the facility that actually got picked', () => {
    expect(isUnsuitable('U.S. Customs and Border Protection', { man_made: 'maritime' })).toBe(true);
  });

  it.each([
    ['Savannah Police Department', {}],
    ['Chatham County Sheriff', {}],
    ['Fort Pulaski Military Reservation', {}],
    ['Memorial Health University Hospital', {}],
    ['Massie Heritage School', {}],
    ['British Consulate', {}],
  ])('rejects %s by name', (name, tags) => {
    expect(isUnsuitable(name, tags as Record<string, string>)).toBe(true);
  });

  it.each([
    ['amenity', 'police'],
    ['amenity', 'hospital'],
    ['amenity', 'kindergarten'],
    ['military', 'bunker'],
    ['office', 'government'],
    ['power', 'substation'],
  ])('rejects %s=%s by tag', (key, value) => {
    expect(isUnsuitable('Perfectly Innocent Name', { [key]: value })).toBe(true);
  });

  it.each([
    ['First African Baptist Church', { historic: 'church' }],
    ['Forsyth Park Fountain', { man_made: 'fountain' }],
    ['Trustees Theatre', { amenity: 'theatre' }],
    ['Owens-Thomas House', { tourism: 'attraction' }],
    ['Old Harbor Light', { man_made: 'lighthouse' }],
    ['Cathedral of Saint John the Baptist', { building: 'cathedral' }],
  ])('keeps %s', (name, tags) => {
    expect(isUnsuitable(name, tags as Record<string, string>)).toBe(false);
  });

  it('does not reject a school-free name for containing "cool"', () => {
    expect(isUnsuitable('Cool Springs Monument', {})).toBe(false);
  });
});
