import { computed } from '@ember/object';
import { inject as service } from '@ember/service';
import Component from '@ember/component';
import { htmlSafe } from '@ember/template';



/* global CSS */

const dLog = console.debug;

export default Component.extend({
  tagName : 'li',

  didRender : function() {
    let server = this.get('apiServer'),
    firstTab = server.get('firstTab');
    if (firstTab)
    {
      console.log('didRender', firstTab, this, server.name);
      server.set('firstTab', false);
      this.addClassActive();
    }
  },

  addClassActive : function()
  {
    let li = this.element;
    console.log('addClassActive', this.apiServerName, li, li && li.classList);
    li.classList.add("active");
  },

  borderStyle : computed('apiServer.name', function() {
    let apiServerColour = this.get('apiServer').get('colour'),
    style = 'border-color:' + apiServerColour;
    dLog('borderStyle', apiServerColour, this.apiServerName);
    return htmlSafe(style);
  })
  
});
