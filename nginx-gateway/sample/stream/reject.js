export default {
  check(s) {
    const is_local = s.variables.is_local;
    const is_jp    = s.variables.is_jp;

    if (is_local === '0' && is_jp === '0') {
      s.deny();
      return;
    }

    s.allow();
  }
}
