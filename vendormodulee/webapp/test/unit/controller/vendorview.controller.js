/*global QUnit*/

sap.ui.define([
	"vendormodulee/controller/vendorview.controller"
], function (Controller) {
	"use strict";

	QUnit.module("vendorview Controller");

	QUnit.test("I should test the vendorview controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
