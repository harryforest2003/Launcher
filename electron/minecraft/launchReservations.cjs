// Reserve before token refresh. Different instances/accounts can prepare concurrently.
function createLaunchReservations() {
    const instances = new Set();
    const accounts = new Map();
    return {
        reserve(instance, accountId) {
            if (instances.has(instance)) throw new Error(`"${instance}" is already preparing to launch.`);
            if (accountId && accounts.has(accountId)) throw new Error(`This account is preparing to launch "${accounts.get(accountId)}". Choose another account or wait.`);
            instances.add(instance);
            if (accountId) accounts.set(accountId, instance);
            let released = false;
            return () => {
                if (released) return;
                released = true;
                instances.delete(instance);
                if (accountId) accounts.delete(accountId);
            };
        },
    };
}
module.exports = { createLaunchReservations };
