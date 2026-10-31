import { readFileSync } from "node:fs";

describe("自建正式服务器原子发布脚本", () => {
  it("在服务器关闭 SCP/SFTP 时以受控 SSH 下载/校验路径发布，且不移除完整性和回滚保护", () => {
    const source = readFileSync(new URL("./publish-self-host-release.sh", import.meta.url), "utf8");

    expect(source).toContain("upload_via_ssh");
    expect(source).toContain("base64 -w 0");
    expect(source).toContain("base64 -d");
    expect(source).toContain('upload_sentinel="__YX_RELEASE_UPLOAD_END__"');
    expect(source).toContain("while IFS= read -r upload_line");
    expect(source).toContain('ssh_key_path="${SSH_KEY_PATH:-}"');
    expect(source).toContain('ssh -tt "${ssh_options[@]}"');
    expect(source).toContain("PreferredAuthentications=publickey");
    expect(source).toContain("PasswordAuthentication=no");
    expect(source).toContain("trap rollback ERR");
    expect(source).toContain("sha256sum");
    expect(source).toContain('health_url="${HEALTH_URL:-http://127.0.0.1:18080/api/health}"');
    expect(source).toContain('grep -q \'"ok":true\'');
    expect(source).toContain('[[ "$(readlink -f "$APP_ROOT/current")" == "$new_release" ]]');
    expect(source).toContain('mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"');
    expect(source).not.toContain(" sshpass -e scp ");
  });
});
