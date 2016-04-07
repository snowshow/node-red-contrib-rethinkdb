'use strict';

module.exports = exports = function (RED) {
	const vm = require('vm');
	const r = require('rethinkdb');

	function RethinkdbInNode(config) {
		RED.nodes.createNode(this, config);
		this.conf = RED.nodes.getNode(config.rethinkdbConfig);
		if (!this.conf || !this.conf.credentials) {
			this.status({fill: 'red', shape: 'dot', text: 'Missing RethinkDB config'});
			return;
		}
		this.status({fill: 'grey', shape: 'dot', text: 'Connecting'});
		this.connection = r.connect(this.conf.credentials);
		this.connection
			.then(conn => {
				this.conn = conn;
				this.status({fill: 'green', shape: 'dot', text: 'Connected'});
			})
			.catch(err => {
				this.conn = null;
				this.status({fill: 'red', shape: 'dot', text: err.message});
				this.error(err);
			});

		this.on('close', done => {
			this.status({fill: 'grey', shape: 'ring', text: 'Closed'});
			if (this.conn) {
				this.conn.close(done);
			} else {
				done();
			}
		});

		const node = this;
		const sandbox = {
			r,
			context: {
				set: function () {
					node.context().set.apply(node, arguments);
				},
				get: function () {
					return node.context().get.apply(node, arguments);
				},
				get global() {
					return node.context().global;
				},
				get flow() {
					return node.context().flow;
				}
			},
			flow: {
				set: function () {
					node.context().flow.set.apply(node, arguments);
				},
				get: function () {
					return node.context().flow.get.apply(node, arguments);
				}
			},
			global: {
				set: function () {
					node.context().global.set.apply(node, arguments);
				},
				get: function () {
					return node.context().global.get.apply(node, arguments);
				}
			}
		};
		try {
			const script = vm.createScript(`
				const q = (function (msg) {
					return ${config.query || null};
				})(msg);
			`);
			this.on('input', msg => {
				const context = Object.assign({msg}, sandbox);
				try {
					script.runInNewContext(context);
				} catch (err) {
					this.error(err, msg);
				}
				if (context.q) {
					this.connection
						.then(conn => {
							this.status({fill: 'yellow', shape: 'dot', text: 'Running query'});
							return context.q.run(conn);
						})
						.then(() => {
							this.status({fill: 'green', shape: 'dot', text: 'Idle'});
						})
						.catch(err => {
							this.status({fill: 'red', shape: 'dot', text: err.message});
							this.error(err, msg);
						});
				}
			});
		} catch (err) {
			this.error(err);
		}
	}
	RED.nodes.registerType('rethinkdb-in', RethinkdbInNode);
};